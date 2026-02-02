import { defineBackend } from '@aws-amplify/backend';
import * as cdk from 'aws-cdk-lib';
import { auth } from './auth/resource';

// Import custom CDK stacks
import { VpcStack } from './custom/vpc-stack';
import { DatabaseStack } from './custom/database-stack';
import { LambdaStack } from './custom/lambda-stack';
import { ApiGatewayStack } from './custom/api-gateway-stack';
import { MigrationStack } from './custom/migration-stack';

/**
 * Define the Amplify backend with custom infrastructure
 *
 * This configuration replaces the default AppSync + DynamoDB setup with:
 * - API Gateway HTTP API
 * - Lambda function (Node.js 20, ARM64)
 * - Aurora PostgreSQL Serverless v2
 * - RDS Proxy for connection pooling
 *
 * Cognito authentication is retained and enhanced with JWT authorization.
 */
const backend = defineBackend({
  auth,
  // Note: We've removed 'data' as we're replacing AppSync with custom API
});

// Get the underlying CDK stack
const authStack = backend.auth.stack;
const customStack = backend.createStack('CustomResources');

// ============================================================================
// VPC Stack
// ============================================================================
const vpcStack = new VpcStack(customStack, 'VpcStack', {
  useNatInstance: true, // Cost optimization for dev
  maxAzs: 2,
});

// ============================================================================
// Database Stack
// ============================================================================
const databaseStack = new DatabaseStack(customStack, 'DatabaseStack', {
  vpc: vpcStack.vpc,
  auroraSecurityGroup: vpcStack.auroraSecurityGroup,
  rdsProxySecurityGroup: vpcStack.rdsProxySecurityGroup,
  lambdaSecurityGroup: vpcStack.lambdaSecurityGroup,
  databaseName: 'appdb',
  minCapacity: 0.5,
  maxCapacity: 4,
  deletionProtection: false, // Set to true for production
});

// ============================================================================
// Lambda Stack
// ============================================================================
const lambdaStack = new LambdaStack(customStack, 'LambdaStack', {
  vpc: vpcStack.vpc,
  securityGroup: vpcStack.lambdaSecurityGroup,
  databaseSecret: databaseStack.secret,
  proxyEndpoint: databaseStack.proxyEndpoint,
  databaseName: 'appdb',
  memorySize: 1024,
  timeout: 30,
  provisionedConcurrency: 0, // Set > 0 for production
});

// ============================================================================
// API Gateway Stack
// ============================================================================
const apiGatewayStack = new ApiGatewayStack(customStack, 'ApiGatewayStack', {
  apiFunction: lambdaStack.apiFunction,
  userPool: backend.auth.resources.userPool,
  userPoolClient: backend.auth.resources.userPoolClient,
  allowedOrigins: ['*'], // Restrict in production
  stageName: 'api',
});

// ============================================================================
// Migration Stack
// ============================================================================
const migrationStack = new MigrationStack(customStack, 'MigrationStack', {
  vpc: vpcStack.vpc,
  securityGroup: vpcStack.lambdaSecurityGroup,
  databaseSecret: databaseStack.secret,
  proxyEndpoint: databaseStack.proxyEndpoint,
  databaseName: 'appdb',
  runOnDeploy: false, // Set to true to auto-run migrations on each deploy
});

// ============================================================================
// Outputs
// ============================================================================

// Add API endpoint to Amplify outputs for frontend consumption
backend.addOutput({
  custom: {
    apiEndpoint: apiGatewayStack.apiEndpoint,
    apiRegion: cdk.Stack.of(customStack).region,
    migrationFunctionName: migrationStack.migrationFunction.functionName,
  },
});

// Export for use in the application
export { backend };
