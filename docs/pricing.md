# Pricing Estimation

## Cost Analysis: 80 Models, 10,000 Monthly Active Users

This document provides detailed cost estimates for the Aurora PostgreSQL architecture compared to the original DynamoDB approach.

---

## Executive Summary

| Environment | AppSync + DynamoDB | API Gateway + Lambda + Aurora |
|-------------|-------------------|-------------------------------|
| **Development/Testing** | $30 - $60/month | **$80 - $140/month** |
| **Production** | $80 - $150/month | **$300 - $460/month** |

**Recommendation:** The Aurora architecture costs more but is justified for 80 interconnected models requiring complex relational queries, ACID transactions, and SQL-based reporting.

---

## Assumptions

### Usage Patterns (10,000 MAU)

| Metric | Value | Notes |
|--------|-------|-------|
| **Monthly Active Users** | 10,000 | Unique authenticated users |
| **Daily Active Users** | 2,000 | ~20% DAU/MAU ratio |
| **API Calls/User/Day** | 25 | Typical SaaS usage |
| **Monthly API Calls** | 1,500,000 | 2,000 × 25 × 30 |
| **Avg Request Size** | 2 KB | Request payload |
| **Avg Response Size** | 5 KB | Response payload |
| **DB Reads:Writes** | 80:20 | Typical read-heavy workload |

### Data Volume

| Metric | Value |
|--------|-------|
| **Models** | 80 |
| **Avg Rows per Model** | 50,000 |
| **Total Rows** | 4,000,000 |
| **Avg Row Size** | 500 bytes |
| **Total Database Size** | ~2 GB |

---

## Development/Testing Environment

### Cost-Optimized Configuration

| Service | Configuration | Monthly Cost |
|---------|---------------|--------------|
| **Aurora PostgreSQL Serverless v2** | 0.5-4 ACU, avg 1 ACU | $43.20 - $86.40 |
| **RDS Proxy** | 1 vCPU equivalent | $21.60 |
| **Lambda** | 500K invocations, 1024MB ARM64, 300ms avg | $5.50 - $11.00 |
| **API Gateway HTTP API** | 500K requests | $0.50 |
| **NAT Instance** | t4g.nano (instead of NAT Gateway) | $3.07 |
| **Secrets Manager** | 1 secret, 10K API calls | $0.43 |
| **Cognito** | 10,000 MAU (free tier) | $0.00 |
| **Data Transfer** | 20GB egress | $1.80 |
| **CloudWatch** | Logs & basic metrics | $3.00 - $5.00 |
| **EBS (NAT Instance)** | 8GB gp3 | $0.64 |
| **TOTAL** | | **$80 - $130/month** |

### Detailed Breakdown

#### Aurora Serverless v2

```
Pricing: $0.12/ACU-hour (us-east-1)

Development Usage:
- Min capacity: 0.5 ACU
- Max capacity: 4 ACU
- Avg utilization: 1 ACU (most of the time at minimum)

Monthly Cost:
- Hours/month: 720
- Low estimate: 0.5 ACU × 720 × $0.12 = $43.20
- High estimate: 1.0 ACU × 720 × $0.12 = $86.40

Storage: $0.10/GB-month × 2GB = $0.20 (negligible)
I/O: $0.20 per 1M requests × 2M = $0.40 (negligible)
```

#### RDS Proxy

```
Pricing: $0.015/vCPU-hour

Development Configuration:
- Minimum: 2 vCPU
- Hours/month: 720

Monthly Cost: 2 × 720 × $0.015 = $21.60
```

#### Lambda

```
Pricing (ARM64):
- Requests: $0.20 per 1M requests
- Duration: $0.0000133334 per GB-second

Development Usage:
- Invocations: 500,000/month
- Memory: 1024MB (1GB)
- Avg duration: 300ms

Monthly Cost:
- Requests: 0.5M × $0.20 = $0.10
- Compute: 500K × 0.3s × 1GB × $0.0000133334 = $2.00
- Free tier offset: -400K GB-seconds = -$5.33
- Total: $2.10 - $8.00 (depending on free tier)
```

#### API Gateway HTTP API

```
Pricing: $1.00 per million requests

Development Usage:
- Requests: 500,000/month

Monthly Cost: 0.5M × $1.00/M = $0.50
```

#### NAT Instance (Cost Optimization)

```
Instance: t4g.nano
- On-demand: $0.0042/hour × 720 = $3.02
- EBS: 8GB gp3 × $0.08/GB = $0.64

Total: $3.66/month

Comparison to NAT Gateway:
- NAT Gateway: $0.045/hour × 720 = $32.40 + data processing
- Savings: ~$30/month
```

---

## Production Environment

### High Availability Configuration

| Service | Configuration | Monthly Cost |
|---------|---------------|--------------|
| **Aurora PostgreSQL Serverless v2** | 0.5-16 ACU, avg 2 ACU + reader | $130 - $220 |
| **RDS Proxy** | 2 vCPUs | $21.60 |
| **Lambda** | 2M invocations, provisioned concurrency | $25 - $45 |
| **API Gateway HTTP API** | 2M requests | $2.00 |
| **NAT Gateway** | 2 gateways (multi-AZ), 100GB transfer | $90 - $130 |
| **Secrets Manager** | 2 secrets (with rotation) | $0.80 |
| **Cognito** | 10,000 MAU (free tier) | $0.00 |
| **Data Transfer** | 100GB egress | $9.00 |
| **CloudWatch** | Enhanced monitoring | $10 - $15 |
| **TOTAL** | | **$290 - $445/month** |

### Detailed Breakdown

#### Aurora Serverless v2 (Production)

```
Writer Instance:
- Avg: 2 ACU
- Peak: 8 ACU
- Monthly: ~2 ACU × 720 × $0.12 = $172.80

Reader Instance (optional for reporting):
- Avg: 1 ACU
- Monthly: 1 ACU × 720 × $0.12 = $86.40

Storage: $0.10/GB × 10GB = $1.00
I/O: $0.20/1M × 10M = $2.00

Total: $130 - $260 (depending on reader)
```

#### NAT Gateway (Production)

```
Pricing:
- Hourly: $0.045/hour
- Data processing: $0.045/GB

Production Configuration (Multi-AZ):
- 2 NAT Gateways: 2 × 720 × $0.045 = $64.80
- Data (100GB): 100 × $0.045 = $4.50
- Total: ~$70 - $130/month
```

#### Lambda with Provisioned Concurrency

```
Base Lambda Cost: ~$15/month (2M invocations)

Provisioned Concurrency:
- 10 instances × 1GB × 720 hours
- $0.000004167 per GB-second
- 10 × 1 × 720 × 3600 × $0.000004167 = $108/month

Alternative: Don't use provisioned concurrency
- Accept 1-3 second cold starts occasionally
- Save ~$100/month
```

---

## Cost Comparison: DynamoDB vs Aurora

### DynamoDB Architecture Cost (Same Scale)

| Service | Configuration | Monthly Cost |
|---------|---------------|--------------|
| **DynamoDB** | On-demand, 4M reads, 1M writes | $15 - $30 |
| **AppSync** | 2M requests, 2M data messages | $8 - $16 |
| **Lambda (resolvers)** | 500K invocations | $3 - $6 |
| **Cognito** | 10,000 MAU | $0 |
| **CloudWatch** | Basic | $2 - $4 |
| **TOTAL** | | **$30 - $60/month** |

### Why Pay More for Aurora?

| Factor | DynamoDB | Aurora |
|--------|----------|--------|
| **Complex JOINs** | ❌ Requires denormalization | ✅ Native SQL |
| **ACID Transactions** | ⚠️ Limited (25 items) | ✅ Full support |
| **Relational Queries** | ❌ Complex GSI design | ✅ Natural |
| **Reporting** | ❌ Scan-heavy, expensive | ✅ SQL aggregations |
| **80 Model Design** | ❌ Denormalization nightmare | ✅ Normalized schema |
| **Developer Experience** | ⚠️ Learning curve | ✅ Familiar SQL/ORM |

### Break-Even Analysis

For a simple application (1-5 models):
→ **DynamoDB wins** on cost and simplicity

For a complex application (80 models, relational data):
→ **Aurora wins** on developer productivity and query flexibility

**Engineering Time Value:**
- 1 hour saved per week × $100/hour × 52 weeks = $5,200/year
- Extra Aurora cost: ~$150/month × 12 = $1,800/year
- **Net savings: $3,400/year** in engineering time

---

## Scaling Projections

### Cost at Different User Scales

| MAU | API Calls/mo | Aurora Cost | Lambda Cost | Total |
|-----|--------------|-------------|-------------|-------|
| 1,000 | 150K | $45 | $3 | **$80** |
| 10,000 | 1.5M | $90 | $12 | **$140** |
| 50,000 | 7.5M | $180 | $50 | **$280** |
| 100,000 | 15M | $300 | $100 | **$450** |
| 500,000 | 75M | $600 | $400 | **$1,100** |

*Note: Costs scale sub-linearly due to Aurora's efficiency with larger datasets and Lambda's pay-per-use model.*

### Database Storage Growth

| Year | Estimated Data | Storage Cost |
|------|----------------|--------------|
| Year 1 | 5 GB | $0.50/month |
| Year 2 | 20 GB | $2.00/month |
| Year 3 | 50 GB | $5.00/month |
| Year 5 | 200 GB | $20.00/month |

*Aurora storage auto-scales; no pre-provisioning required.*

---

## Cost Optimization Strategies

### Already Applied (Development)

| Strategy | Savings |
|----------|---------|
| NAT Instance instead of NAT Gateway | $30/month |
| Lambda ARM64 architecture | 20% compute cost |
| Single-AZ Aurora | 50% Aurora cost |
| No provisioned concurrency | $100/month |
| HTTP API instead of REST API | 70% API Gateway cost |

### Future Optimizations

| Strategy | Potential Savings | Trade-off |
|----------|-------------------|-----------|
| **Reserved Capacity (Aurora)** | 30-50% | 1-year commitment |
| **Compute Savings Plans** | 17% Lambda | 1-year commitment |
| **Schedule Aurora Pause** | 50%+ dev | Downtime during pause |
| **Spot Instances (NAT)** | 60-80% | Possible interruptions |

### Reserved Capacity Example

```
Aurora Serverless v2 (if using consistently):
- On-demand: $0.12/ACU-hour
- Reserved (1-year): $0.08/ACU-hour (estimated)
- Savings: 33%

For 2 ACU average:
- On-demand: $172.80/month
- Reserved: $115.20/month
- Annual savings: $691
```

---

## Cost Monitoring Recommendations

### CloudWatch Billing Alarms

```
Set alerts at:
- 50% of budget: Warning
- 80% of budget: Critical
- 100% of budget: Stop non-essential services
```

### Monthly Review Checklist

- [ ] Check Aurora ACU utilization (right-size if consistently low)
- [ ] Review Lambda duration metrics (optimize slow functions)
- [ ] Check NAT Gateway data transfer (reduce if excessive)
- [ ] Review CloudWatch log retention (reduce if needed)
- [ ] Check for unused resources (delete test stacks)

### Cost Allocation Tags

Apply these tags to all resources for cost tracking:

```
Environment: dev | staging | prod
Project: amplify-sql
Module: accounts | inventory | common
Owner: team-name
```

---

## Conclusion

### Recommended Configuration

| Environment | Configuration | Cost |
|-------------|---------------|------|
| **Development** | NAT Instance, Single-AZ Aurora, no reserved | $80-100/month |
| **Staging** | Same as dev | $80-100/month |
| **Production** | NAT Gateway, Multi-AZ Aurora, optional reserved | $300-400/month |

### Total Annual Cost

| Environment | Monthly | Annual |
|-------------|---------|--------|
| Development | $90 | $1,080 |
| Staging | $90 | $1,080 |
| Production | $350 | $4,200 |
| **Total** | **$530** | **$6,360** |

### ROI Justification

For an 80-model enterprise application:
- Traditional relational queries save 5+ hours/week in development
- ACID transactions prevent data corruption issues
- SQL reporting enables self-service analytics
- Familiar tech stack reduces onboarding time

**The additional $3,000-4,000/year in infrastructure costs is easily offset by developer productivity gains and reduced maintenance burden.**
