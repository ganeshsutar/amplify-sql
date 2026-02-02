import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';

/**
 * Database Stack Configuration
 *
 * Creates Aurora PostgreSQL Serverless v2 with RDS Proxy for
 * efficient connection pooling with Lambda.
 */
export interface DatabaseStackProps extends cdk.NestedStackProps {
  /**
   * VPC where the database will be deployed
   */
  vpc: ec2.IVpc;

  /**
   * Security group for Aurora cluster
   */
  auroraSecurityGroup: ec2.ISecurityGroup;

  /**
   * Security group for RDS Proxy
   */
  rdsProxySecurityGroup: ec2.ISecurityGroup;

  /**
   * Security group for Lambda (needs access to RDS Proxy)
   */
  lambdaSecurityGroup: ec2.ISecurityGroup;

  /**
   * Database name
   * @default 'appdb'
   */
  databaseName?: string;

  /**
   * Minimum ACU capacity for Aurora Serverless v2
   * 0.5 ACU is the minimum and most cost-effective for dev
   * @default 0.5
   */
  minCapacity?: number;

  /**
   * Maximum ACU capacity for Aurora Serverless v2
   * @default 4 for dev, 16 for prod
   */
  maxCapacity?: number;

  /**
   * Enable deletion protection
   * @default false for dev, true for prod
   */
  deletionProtection?: boolean;
}

export class DatabaseStack extends cdk.NestedStack {
  public readonly cluster: rds.DatabaseCluster;
  public readonly proxy: rds.DatabaseProxy;
  public readonly secret: secretsmanager.ISecret;
  public readonly proxyEndpoint: string;

  constructor(scope: Construct, id: string, props: DatabaseStackProps) {
    super(scope, id, props);

    const databaseName = props.databaseName ?? 'appdb';
    const minCapacity = props.minCapacity ?? 0.5;
    const maxCapacity = props.maxCapacity ?? 4;
    const deletionProtection = props.deletionProtection ?? false;

    // Create database credentials secret
    this.secret = new secretsmanager.Secret(this, 'DatabaseSecret', {
      secretName: 'amplify-sql/database-credentials',
      description: 'Aurora PostgreSQL database credentials',
      generateSecretString: {
        secretStringTemplate: JSON.stringify({
          username: 'dbadmin',
        }),
        generateStringKey: 'password',
        excludePunctuation: true, // Simplify for connection strings
        passwordLength: 32,
      },
    });

    // Create Aurora Serverless v2 cluster
    this.cluster = new rds.DatabaseCluster(this, 'AuroraCluster', {
      engine: rds.DatabaseClusterEngine.auroraPostgres({
        version: rds.AuroraPostgresEngineVersion.VER_15_4,
      }),
      credentials: rds.Credentials.fromSecret(this.secret),
      defaultDatabaseName: databaseName,

      // Serverless v2 configuration
      serverlessV2MinCapacity: minCapacity,
      serverlessV2MaxCapacity: maxCapacity,
      writer: rds.ClusterInstance.serverlessV2('writer', {
        publiclyAccessible: false,
      }),

      // Optional: Add a reader for production
      // readers: [
      //   rds.ClusterInstance.serverlessV2('reader', {
      //     scaleWithWriter: true,
      //   }),
      // ],

      // Network configuration
      vpc: props.vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
      },
      securityGroups: [props.auroraSecurityGroup],

      // Storage configuration
      storageEncrypted: true,
      storageType: rds.DBClusterStorageType.AURORA,

      // Backup configuration
      backup: {
        retention: cdk.Duration.days(7),
        preferredWindow: '03:00-04:00', // 3-4 AM UTC
      },

      // Maintenance window
      preferredMaintenanceWindow: 'Sun:04:00-Sun:05:00',

      // Other settings
      deletionProtection,
      removalPolicy: deletionProtection
        ? cdk.RemovalPolicy.RETAIN
        : cdk.RemovalPolicy.DESTROY,

      // Enable CloudWatch logs
      cloudwatchLogsExports: ['postgresql'],
      cloudwatchLogsRetention: cdk.aws_logs.RetentionDays.ONE_WEEK,

      // Parameter group for performance tuning
      parameterGroup: new rds.ParameterGroup(this, 'ParameterGroup', {
        engine: rds.DatabaseClusterEngine.auroraPostgres({
          version: rds.AuroraPostgresEngineVersion.VER_15_4,
        }),
        parameters: {
          // Log slow queries (> 1 second)
          'log_min_duration_statement': '1000',
          // Connection timeout
          'statement_timeout': '30000', // 30 seconds
        },
      }),
    });

    // Create RDS Proxy for connection pooling
    this.proxy = new rds.DatabaseProxy(this, 'RdsProxy', {
      proxyTarget: rds.ProxyTarget.fromCluster(this.cluster),
      secrets: [this.secret],
      vpc: props.vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },
      securityGroups: [props.rdsProxySecurityGroup],

      // Proxy settings
      dbProxyName: 'amplify-sql-proxy',
      debugLogging: false, // Enable for troubleshooting
      idleClientTimeout: cdk.Duration.minutes(30),
      maxConnectionsPercent: 90, // Reserve 10% for admin
      maxIdleConnectionsPercent: 50,
      requireTLS: true,

      // IAM authentication (optional, using secrets for now)
      iamAuth: false,
    });

    // Store the proxy endpoint for Lambda to use
    this.proxyEndpoint = this.proxy.endpoint;

    // Outputs
    new cdk.CfnOutput(this, 'ClusterEndpoint', {
      value: this.cluster.clusterEndpoint.hostname,
      description: 'Aurora Cluster Endpoint (writer)',
    });

    new cdk.CfnOutput(this, 'ProxyEndpoint', {
      value: this.proxyEndpoint,
      description: 'RDS Proxy Endpoint (use this for Lambda)',
    });

    new cdk.CfnOutput(this, 'SecretArn', {
      value: this.secret.secretArn,
      description: 'Database Credentials Secret ARN',
    });

    new cdk.CfnOutput(this, 'DatabaseName', {
      value: databaseName,
      description: 'Database Name',
    });
  }
}
