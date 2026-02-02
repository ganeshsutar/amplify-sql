import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as cr from 'aws-cdk-lib/custom-resources';
import { Construct } from 'constructs';
import * as path from 'path';

/**
 * Migration Stack
 *
 * Creates a Lambda function dedicated to running Prisma migrations.
 * This function has VPC access and can connect to Aurora via RDS Proxy.
 */
export interface MigrationStackProps extends cdk.NestedStackProps {
  vpc: ec2.IVpc;
  securityGroup: ec2.ISecurityGroup;
  databaseSecret: secretsmanager.ISecret;
  proxyEndpoint: string;
  databaseName: string;
  /**
   * Automatically run migrations on deployment
   * @default false
   */
  runOnDeploy?: boolean;
}

export class MigrationStack extends cdk.NestedStack {
  public readonly migrationFunction: lambda.Function;

  constructor(scope: Construct, id: string, props: MigrationStackProps) {
    super(scope, id, props);

    const runOnDeploy = props.runOnDeploy ?? false;

    // Create Lambda execution role
    const lambdaRole = new iam.Role(this, 'MigrationLambdaRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaVPCAccessExecutionRole'),
      ],
    });

    // Grant access to database secret
    props.databaseSecret.grantRead(lambdaRole);

    // Create the migration Lambda
    this.migrationFunction = new nodejs.NodejsFunction(this, 'MigrationFunction', {
      functionName: 'amplify-sql-migrate',
      description: 'Runs Prisma database migrations',
      entry: path.join(__dirname, '../functions/migrate/handler.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 512,
      timeout: cdk.Duration.minutes(5), // Migrations can take time
      vpc: props.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [props.securityGroup],
      role: lambdaRole,
      environment: {
        DATABASE_SECRET_ARN: props.databaseSecret.secretArn,
        DATABASE_PROXY_ENDPOINT: props.proxyEndpoint,
        DATABASE_NAME: props.databaseName,
        ALLOW_RESET: 'false', // Set to 'true' only for dev
      },
      bundling: {
        minify: false, // Keep readable for debugging
        sourceMap: true,
        externalModules: ['@prisma/client', 'prisma'],
        nodeModules: ['@prisma/client', 'prisma'],
        commandHooks: {
          beforeBundling: () => [],
          beforeInstall: () => [],
          afterBundling: (inputDir: string, outputDir: string) => [
            // Copy Prisma schema and migrations
            `cp -r ${inputDir}/amplify/functions/api/prisma ${outputDir}/`,
            // Generate Prisma client for Lambda
            `cd ${outputDir} && npx prisma generate`,
          ],
        },
      },
      logRetention: logs.RetentionDays.ONE_WEEK,
    });

    // Optionally run migrations automatically on deployment
    if (runOnDeploy) {
      const migrationRunner = new cr.AwsCustomResource(this, 'RunMigration', {
        onCreate: {
          service: 'Lambda',
          action: 'invoke',
          parameters: {
            FunctionName: this.migrationFunction.functionName,
            Payload: JSON.stringify({ action: 'deploy' }),
          },
          physicalResourceId: cr.PhysicalResourceId.of(Date.now().toString()),
        },
        onUpdate: {
          service: 'Lambda',
          action: 'invoke',
          parameters: {
            FunctionName: this.migrationFunction.functionName,
            Payload: JSON.stringify({ action: 'deploy' }),
          },
          physicalResourceId: cr.PhysicalResourceId.of(Date.now().toString()),
        },
        policy: cr.AwsCustomResourcePolicy.fromStatements([
          new iam.PolicyStatement({
            actions: ['lambda:InvokeFunction'],
            resources: [this.migrationFunction.functionArn],
          }),
        ]),
      });

      migrationRunner.node.addDependency(this.migrationFunction);
    }

    // Outputs
    new cdk.CfnOutput(this, 'MigrationFunctionName', {
      value: this.migrationFunction.functionName,
      description: 'Migration Lambda function name',
    });

    new cdk.CfnOutput(this, 'MigrationFunctionArn', {
      value: this.migrationFunction.functionArn,
      description: 'Migration Lambda function ARN',
    });
  }
}
