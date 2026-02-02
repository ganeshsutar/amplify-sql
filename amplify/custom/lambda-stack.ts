import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import * as path from 'path';

/**
 * Lambda Stack Configuration
 *
 * Creates the API Lambda function with VPC access for connecting
 * to Aurora PostgreSQL via RDS Proxy.
 */
export interface LambdaStackProps extends cdk.NestedStackProps {
  /**
   * VPC where Lambda will be deployed
   */
  vpc: ec2.IVpc;

  /**
   * Security group for Lambda
   */
  securityGroup: ec2.ISecurityGroup;

  /**
   * Database secret for credentials
   */
  databaseSecret: secretsmanager.ISecret;

  /**
   * RDS Proxy endpoint
   */
  proxyEndpoint: string;

  /**
   * Database name
   */
  databaseName: string;

  /**
   * Memory size in MB
   * @default 1024
   */
  memorySize?: number;

  /**
   * Timeout in seconds
   * @default 30
   */
  timeout?: number;

  /**
   * Enable provisioned concurrency for production
   * @default 0 (disabled)
   */
  provisionedConcurrency?: number;
}

export class LambdaStack extends cdk.NestedStack {
  public readonly apiFunction: lambda.Function;
  public readonly functionUrl?: lambda.FunctionUrl;

  constructor(scope: Construct, id: string, props: LambdaStackProps) {
    super(scope, id, props);

    const memorySize = props.memorySize ?? 1024;
    const timeout = props.timeout ?? 30;
    const provisionedConcurrency = props.provisionedConcurrency ?? 0;

    // Create Lambda execution role
    const lambdaRole = new iam.Role(this, 'LambdaRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      description: 'Execution role for API Lambda function',
      managedPolicies: [
        // Basic Lambda execution (CloudWatch logs)
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          'service-role/AWSLambdaBasicExecutionRole'
        ),
        // VPC access for Lambda
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          'service-role/AWSLambdaVPCAccessExecutionRole'
        ),
      ],
    });

    // Grant access to read database secret
    props.databaseSecret.grantRead(lambdaRole);

    // Create the Lambda function
    this.apiFunction = new nodejs.NodejsFunction(this, 'ApiFunction', {
      functionName: 'amplify-sql-api',
      description: 'API handler for Amplify SQL application',

      // Code location
      entry: path.join(__dirname, '../functions/api/handler.ts'),
      handler: 'handler',

      // Runtime configuration
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64, // 20% cheaper, faster cold starts
      memorySize,
      timeout: cdk.Duration.seconds(timeout),

      // VPC configuration
      vpc: props.vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },
      securityGroups: [props.securityGroup],

      // IAM role
      role: lambdaRole,

      // Environment variables
      environment: {
        NODE_ENV: 'production',
        DATABASE_URL: this.buildDatabaseUrl(props),
        DATABASE_SECRET_ARN: props.databaseSecret.secretArn,
        // Prisma-specific
        PRISMA_QUERY_ENGINE_LIBRARY: '/opt/nodejs/libquery_engine-linux-arm64-openssl-3.0.x.so.node',
      },

      // Bundling configuration for Prisma
      bundling: {
        minify: true,
        sourceMap: true,
        externalModules: [
          // Don't bundle Prisma engine - use Lambda layer instead
          '@prisma/client',
          'prisma',
        ],
        nodeModules: [
          '@prisma/client',
          'prisma',
        ],
        commandHooks: {
          beforeBundling: () => [],
          beforeInstall: () => [],
          afterBundling: (inputDir: string, outputDir: string) => [
            // Generate Prisma client for the target platform
            `cd ${outputDir} && npx prisma generate`,
            // Copy Prisma schema
            `cp ${inputDir}/amplify/functions/api/prisma/schema.prisma ${outputDir}/`,
          ],
        },
        // Target the Lambda Node.js environment
        target: 'node20',
        format: lambda.OutputFormat.ESM,
        mainFields: ['module', 'main'],
      },

      // Logging
      logRetention: logs.RetentionDays.ONE_WEEK,

      // Performance tuning
      tracing: lambda.Tracing.ACTIVE, // Enable X-Ray tracing
    });

    // Add provisioned concurrency if configured
    if (provisionedConcurrency > 0) {
      const version = this.apiFunction.currentVersion;
      new lambda.Alias(this, 'LiveAlias', {
        aliasName: 'live',
        version,
        provisionedConcurrentExecutions: provisionedConcurrency,
      });
    }

    // Create Function URL (optional, for testing without API Gateway)
    this.functionUrl = this.apiFunction.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE, // API Gateway handles auth
      cors: {
        allowedOrigins: ['*'],
        allowedMethods: [lambda.HttpMethod.ALL],
        allowedHeaders: ['*'],
      },
    });

    // Outputs
    new cdk.CfnOutput(this, 'FunctionName', {
      value: this.apiFunction.functionName,
      description: 'Lambda Function Name',
    });

    new cdk.CfnOutput(this, 'FunctionArn', {
      value: this.apiFunction.functionArn,
      description: 'Lambda Function ARN',
    });

    if (this.functionUrl) {
      new cdk.CfnOutput(this, 'FunctionUrl', {
        value: this.functionUrl.url,
        description: 'Lambda Function URL (for testing)',
      });
    }
  }

  /**
   * Builds the DATABASE_URL for Prisma
   * Uses a placeholder that will be resolved at runtime from Secrets Manager
   */
  private buildDatabaseUrl(props: LambdaStackProps): string {
    // At runtime, Lambda will fetch credentials from Secrets Manager
    // and construct the actual connection string
    // This is a template that Prisma expects
    return `postgresql://PLACEHOLDER:PLACEHOLDER@${props.proxyEndpoint}:5432/${props.databaseName}?schema=public&connection_limit=1`;
  }
}
