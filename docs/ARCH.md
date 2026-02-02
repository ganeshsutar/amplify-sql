# Architecture Documentation

## Migration: DynamoDB to Aurora PostgreSQL with API Gateway + Lambda

This document describes the architecture for migrating from AWS Amplify's AppSync + DynamoDB stack to a more traditional REST API architecture using API Gateway, Lambda, and Aurora PostgreSQL.

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture Diagram](#architecture-diagram)
3. [Component Details](#component-details)
4. [Data Flow](#data-flow)
5. [Security Architecture](#security-architecture)
6. [Database Design](#database-design)
7. [Performance Considerations](#performance-considerations)
8. [Deployment Architecture](#deployment-architecture)

---

## Overview

### Current Architecture (Before Migration)

```
┌─────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   React     │────▶│    AppSync       │────▶│   DynamoDB      │
│   Frontend  │     │   (GraphQL)      │     │   (NoSQL)       │
└─────────────┘     └──────────────────┘     └─────────────────┘
      │                     │
      └─────────────────────┼─────────────────┐
                            ▼                 │
                     ┌─────────────┐          │
                     │   Cognito   │──────────┘
                     │   (Auth)    │
                     └─────────────┘
```

**Limitations of Current Architecture:**
- DynamoDB's NoSQL model struggles with complex relational queries
- Difficult to model 80+ interconnected business entities
- No native support for JOINs, transactions across tables
- Complex access patterns require multiple indexes

### Target Architecture (After Migration)

```
┌─────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   React     │────▶│  API Gateway     │────▶│    Lambda       │
│   Frontend  │     │  (HTTP API)      │     │  (Node.js 20)   │
└─────────────┘     └──────────────────┘     └─────────────────┘
      │                     │                        │
      │              ┌──────┴──────┐                 │
      └─────────────▶│   Cognito   │                 ▼
                     │   (JWT)     │          ┌─────────────┐
                     └─────────────┘          │  RDS Proxy  │
                                              └─────────────┘
                                                     │
                                                     ▼
                                              ┌─────────────────────┐
                                              │  Aurora PostgreSQL  │
                                              │   Serverless v2     │
                                              └─────────────────────┘
```

**Benefits of Target Architecture:**
- Full SQL support for complex relational queries
- ACID transactions for data integrity
- Prisma ORM for type-safe database access
- Better suited for 80+ interconnected models
- Mature tooling for reporting and analytics

---

## Architecture Diagram

### Detailed Network Architecture

```
┌────────────────────────────────────────────────────────────────────────────┐
│                              AWS Cloud                                      │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                           VPC (10.0.0.0/16)                           │  │
│  │                                                                        │  │
│  │  ┌─────────────────────────┐    ┌─────────────────────────┐          │  │
│  │  │   Public Subnet (AZ-a)  │    │   Public Subnet (AZ-b)  │          │  │
│  │  │      10.0.1.0/24        │    │      10.0.2.0/24        │          │  │
│  │  │  ┌──────────────────┐   │    │                         │          │  │
│  │  │  │   NAT Instance   │   │    │                         │          │  │
│  │  │  │   (t4g.nano)     │   │    │                         │          │  │
│  │  │  └──────────────────┘   │    │                         │          │  │
│  │  └─────────────────────────┘    └─────────────────────────┘          │  │
│  │                                                                        │  │
│  │  ┌─────────────────────────┐    ┌─────────────────────────┐          │  │
│  │  │  Private Subnet (AZ-a)  │    │  Private Subnet (AZ-b)  │          │  │
│  │  │      10.0.3.0/24        │    │      10.0.4.0/24        │          │  │
│  │  │  ┌──────────────────┐   │    │  ┌──────────────────┐   │          │  │
│  │  │  │     Lambda       │   │    │  │     Lambda       │   │          │  │
│  │  │  │   (ENI in VPC)   │   │    │  │   (ENI in VPC)   │   │          │  │
│  │  │  └──────────────────┘   │    │  └──────────────────┘   │          │  │
│  │  │  ┌──────────────────┐   │    │  ┌──────────────────┐   │          │  │
│  │  │  │    RDS Proxy     │   │    │  │    RDS Proxy     │   │          │  │
│  │  │  │   (endpoint)     │   │    │  │   (endpoint)     │   │          │  │
│  │  │  └──────────────────┘   │    │  └──────────────────┘   │          │  │
│  │  └─────────────────────────┘    └─────────────────────────┘          │  │
│  │                                                                        │  │
│  │  ┌─────────────────────────┐    ┌─────────────────────────┐          │  │
│  │  │ Isolated Subnet (AZ-a)  │    │ Isolated Subnet (AZ-b)  │          │  │
│  │  │      10.0.5.0/24        │    │      10.0.6.0/24        │          │  │
│  │  │  ┌──────────────────┐   │    │  ┌──────────────────┐   │          │  │
│  │  │  │     Aurora       │   │    │  │     Aurora       │   │          │  │
│  │  │  │    (Writer)      │   │    │  │    (Reader)      │   │          │  │
│  │  │  └──────────────────┘   │    │  └──────────────────┘   │          │  │
│  │  └─────────────────────────┘    └─────────────────────────┘          │  │
│  │                                                                        │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐                 │
│  │  API Gateway   │  │    Cognito     │  │    Secrets     │                 │
│  │  (HTTP API)    │  │  (User Pool)   │  │    Manager     │                 │
│  └────────────────┘  └────────────────┘  └────────────────┘                 │
│                                                                              │
└────────────────────────────────────────────────────────────────────────────┘
```

---

## Component Details

### 1. Amazon API Gateway (HTTP API)

**Purpose:** Entry point for all REST API requests

**Configuration:**
- **Type:** HTTP API (lower latency, lower cost than REST API)
- **Authorization:** JWT Authorizer with Cognito
- **CORS:** Configured for frontend domain
- **Routes:** RESTful routes for all 80 models

**Key Features:**
- Automatic request/response transformation
- Built-in throttling and rate limiting
- CloudWatch metrics and logging
- $1.00 per million requests

### 2. AWS Lambda

**Purpose:** Business logic execution and database operations

**Configuration:**
- **Runtime:** Node.js 20.x
- **Architecture:** ARM64 (Graviton2) - 20% cheaper, faster cold starts
- **Memory:** 1024 MB
- **Timeout:** 30 seconds
- **VPC:** Deployed in private subnets

**Key Features:**
- Prisma ORM for database access
- Connection pooling via RDS Proxy
- Environment variables for configuration
- Secrets Manager integration for credentials

### 3. Amazon RDS Proxy

**Purpose:** Connection pooling and management for Aurora

**Configuration:**
- **Engine:** PostgreSQL
- **Idle Timeout:** 30 minutes
- **Max Connections:** 90% of Aurora max
- **Authentication:** IAM-based

**Benefits:**
- Eliminates connection overhead on Lambda cold starts
- Handles connection pooling automatically
- Provides failover support
- Reduces database load from connection churn

### 4. Amazon Aurora PostgreSQL Serverless v2

**Purpose:** Relational database for all application data

**Configuration:**
- **Engine:** PostgreSQL 15.4
- **Capacity:** 0.5 - 16 ACU (auto-scaling)
- **Storage:** Auto-scaling up to 128 TB
- **Backup:** Automated daily backups, 7-day retention

**Why Aurora Serverless v2:**
- Scales to zero-ish (0.5 ACU minimum)
- Sub-second scaling for traffic spikes
- Pay only for capacity used
- Multi-AZ for high availability

### 5. Amazon Cognito

**Purpose:** User authentication and authorization

**Configuration:**
- **Login:** Email-based authentication
- **MFA:** Optional (recommended for production)
- **Token Expiry:** 1 hour (access), 30 days (refresh)

**JWT Claims Used:**
- `sub` - Unique user identifier
- `email` - User email address
- `cognito:groups` - User group memberships

### 6. AWS Secrets Manager

**Purpose:** Secure storage for database credentials

**Configuration:**
- **Rotation:** Automatic every 30 days
- **Access:** IAM-based, Lambda role only

---

## Data Flow

### Authentication Flow

```
1. User → Frontend: Enter credentials
2. Frontend → Cognito: Authenticate
3. Cognito → Frontend: Return JWT tokens
4. Frontend: Store tokens in memory/localStorage
5. Frontend → API Gateway: Request + JWT in Authorization header
6. API Gateway → Cognito: Validate JWT
7. API Gateway → Lambda: Forward request with user claims
```

### API Request Flow

```
1. Client → API Gateway: HTTPS request with JWT
2. API Gateway: Validate JWT, extract claims
3. API Gateway → Lambda: Invoke with event
4. Lambda: Parse request, validate input
5. Lambda → Secrets Manager: Get DB credentials (cached)
6. Lambda → RDS Proxy: Database query via Prisma
7. RDS Proxy → Aurora: Execute SQL
8. Aurora → RDS Proxy → Lambda: Return results
9. Lambda → API Gateway: JSON response
10. API Gateway → Client: HTTP response
```

### Database Transaction Flow (Example: Create Order)

```
1. Lambda: Begin transaction
2. Lambda: Validate product availability
3. Lambda: Create order record
4. Lambda: Create order items
5. Lambda: Update stock quantities
6. Lambda: Create audit log entry
7. Lambda: Commit transaction
8. (On error): Rollback transaction
```

---

## Security Architecture

### Network Security

| Layer | Protection |
|-------|------------|
| **Internet → API Gateway** | AWS Shield, WAF (optional) |
| **API Gateway → Lambda** | IAM roles, VPC endpoints |
| **Lambda → RDS Proxy** | Security groups, TLS |
| **RDS Proxy → Aurora** | Security groups, IAM auth |

### Security Groups

```
┌─────────────────────────────────────────────────────────┐
│                    Security Groups                       │
├─────────────────────────────────────────────────────────┤
│  Lambda SG:                                              │
│    Outbound: All traffic (for Secrets Manager, etc.)    │
│                                                          │
│  RDS Proxy SG:                                          │
│    Inbound: PostgreSQL (5432) from Lambda SG            │
│    Outbound: PostgreSQL (5432) to Aurora SG             │
│                                                          │
│  Aurora SG:                                             │
│    Inbound: PostgreSQL (5432) from RDS Proxy SG         │
│    Outbound: None (isolated)                            │
└─────────────────────────────────────────────────────────┘
```

### Data Security

- **At Rest:** Aurora encryption with AWS KMS
- **In Transit:** TLS 1.2+ for all connections
- **Secrets:** AWS Secrets Manager with automatic rotation
- **Audit:** CloudTrail for API calls, Aurora audit logs

### Application Security

- **Input Validation:** Zod schema validation on all inputs
- **SQL Injection:** Prevented by Prisma parameterized queries
- **Authorization:** Row-level security based on organization/user
- **Rate Limiting:** API Gateway throttling

---

## Database Design

### Schema Overview

The database is organized into two main modules:

#### Accounts Module
- **User** - Application users linked to Cognito
- **Organization** - Multi-tenant organization support
- **Role** - Permission roles (Admin, Manager, Viewer)
- **UserRole** - Many-to-many user-role assignments
- **AuditLog** - Activity tracking for compliance

#### Inventory Module
- **Category** - Hierarchical product categories
- **Product** - Product master data
- **Warehouse** - Storage locations
- **StockItem** - Inventory levels per product/warehouse
- **Supplier** - Vendor information
- **PurchaseOrder** - Procurement orders
- **PurchaseOrderItem** - Line items for orders

### Entity Relationship Diagram

```
┌──────────────┐       ┌──────────────┐       ┌──────────────┐
│     User     │──────▶│  UserRole    │◀──────│     Role     │
└──────────────┘       └──────────────┘       └──────────────┘
       │
       │ belongs to
       ▼
┌──────────────┐       ┌──────────────┐       ┌──────────────┐
│ Organization │──────▶│   Product    │──────▶│   Category   │
└──────────────┘       └──────────────┘       └──────────────┘
       │                      │                      │
       │                      │                      │ self-ref
       ▼                      ▼                      ▼
┌──────────────┐       ┌──────────────┐       ┌──────────────┐
│  Warehouse   │◀──────│  StockItem   │       │   Category   │
└──────────────┘       └──────────────┘       │  (children)  │
                                              └──────────────┘

┌──────────────┐       ┌──────────────────┐
│   Supplier   │──────▶│  PurchaseOrder   │
└──────────────┘       └──────────────────┘
                              │
                              ▼
                       ┌──────────────────┐
                       │PurchaseOrderItem │
                       └──────────────────┘
```

### Indexing Strategy

All tables include indexes for:
- Primary keys (automatic)
- Foreign keys (for JOINs)
- Frequently filtered columns
- Composite indexes for common query patterns

---

## Performance Considerations

### Cold Start Mitigation

| Technique | Impact | Cost |
|-----------|--------|------|
| **RDS Proxy** | Eliminates DB connection overhead | ~$22/month |
| **ARM64 Lambda** | 10-20% faster cold starts | 20% cheaper |
| **Provisioned Concurrency** | Near-zero cold starts | Extra compute cost |
| **Small bundle size** | Faster initialization | Engineering effort |

### Expected Latencies

| Operation | Cold Start | Warm |
|-----------|------------|------|
| **API Gateway** | - | 5-10ms |
| **Lambda Init** | 500-1500ms | - |
| **Prisma Init** | 200-400ms | - |
| **DB Connection (Proxy)** | 10-20ms | 1-5ms |
| **Simple Query** | - | 5-20ms |
| **Complex Query** | - | 50-200ms |
| **End-to-End (cold)** | 1-3s | - |
| **End-to-End (warm)** | - | 100-300ms |

### Scaling Limits

| Component | Limit | Notes |
|-----------|-------|-------|
| **API Gateway** | 10,000 RPS | Soft limit, can increase |
| **Lambda Concurrency** | 1,000 | Per account, can increase |
| **RDS Proxy** | 1,000 connections | Per proxy |
| **Aurora** | 16 ACU max | Configurable |

---

## Deployment Architecture

### Development Environment

```
┌─────────────────────────────────────────┐
│          Development Stack              │
├─────────────────────────────────────────┤
│  VPC: 2 AZs, 1 NAT Instance             │
│  Aurora: 0.5-4 ACU, Single-AZ           │
│  Lambda: Default concurrency            │
│  Estimated Cost: $80-140/month          │
└─────────────────────────────────────────┘
```

### Production Environment

```
┌─────────────────────────────────────────┐
│          Production Stack               │
├─────────────────────────────────────────┤
│  VPC: 2 AZs, 2 NAT Gateways             │
│  Aurora: 0.5-16 ACU, Multi-AZ + Reader  │
│  Lambda: Provisioned Concurrency (10)   │
│  Estimated Cost: $300-460/month         │
└─────────────────────────────────────────┘
```

### CI/CD Pipeline

```
┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
│  GitHub  │───▶│  Amplify │───▶│   Build  │───▶│  Deploy  │
│   Push   │    │ Pipeline │    │  & Test  │    │   AWS    │
└──────────┘    └──────────┘    └──────────┘    └──────────┘
                                      │
                                      ▼
                               ┌──────────┐
                               │  Prisma  │
                               │ Migrate  │
                               └──────────┘
```

---

## Technology Decisions

### Why Prisma ORM?

| Feature | Benefit |
|---------|---------|
| **Type Safety** | Full TypeScript support, compile-time query validation |
| **Migrations** | Declarative schema, automatic migration generation |
| **Query Builder** | Intuitive API, prevents SQL injection |
| **Performance** | Query optimization, lazy loading |
| **Developer Experience** | Excellent tooling, Prisma Studio |

### Why HTTP API over REST API?

| Feature | HTTP API | REST API |
|---------|----------|----------|
| **Latency** | Lower | Higher |
| **Cost** | $1.00/M | $3.50/M |
| **Features** | Essential | Full |
| **JWT Auth** | Built-in | Custom |

For our use case, HTTP API provides all needed features at lower cost.

### Why Aurora Serverless v2 over Provisioned?

| Aspect | Serverless v2 | Provisioned |
|--------|---------------|-------------|
| **Scaling** | Automatic | Manual |
| **Min Cost** | 0.5 ACU (~$45/mo) | 2 vCPU (~$90/mo) |
| **Burst Capacity** | Instant | Requires planning |
| **Dev/Test** | Excellent | Overkill |

For variable workloads and development, Serverless v2 is ideal.

---

## Future Enhancements

### Phase 2 Considerations

1. **Read Replicas** - Add Aurora readers for reporting workloads
2. **ElastiCache** - Add Redis for session/query caching
3. **Event-Driven** - Add EventBridge for async processing
4. **GraphQL** - Optional AppSync layer for subscriptions

### Monitoring & Observability

- CloudWatch dashboards for all components
- X-Ray tracing for request flow
- CloudWatch Alarms for critical metrics
- Log aggregation with CloudWatch Logs Insights

---

## References

- [AWS Amplify Gen 2 Documentation](https://docs.amplify.aws/gen2/)
- [Prisma with AWS Lambda](https://www.prisma.io/docs/guides/deployment/deployment-guides/deploying-to-aws-lambda)
- [Aurora Serverless v2](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-serverless-v2.html)
- [RDS Proxy Best Practices](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/rds-proxy.html)
