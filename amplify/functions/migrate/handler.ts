import { execSync } from 'child_process';
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';

/**
 * Migration Lambda Function
 *
 * This function runs Prisma migrations against Aurora PostgreSQL.
 * It should be invoked manually or via CI/CD after deployment.
 *
 * Security: This Lambda runs in the VPC with access to RDS Proxy.
 */

const secretsManager = new SecretsManagerClient({});

interface MigrationEvent {
  action?: 'deploy' | 'status' | 'reset';
}

interface MigrationResult {
  success: boolean;
  action: string;
  output?: string;
  error?: string;
}

export async function handler(event: MigrationEvent): Promise<MigrationResult> {
  const action = event.action || 'deploy';

  console.log(`Running migration action: ${action}`);

  try {
    // Get database credentials
    const secretArn = process.env.DATABASE_SECRET_ARN;
    if (!secretArn) {
      throw new Error('DATABASE_SECRET_ARN not set');
    }

    const secretResponse = await secretsManager.send(
      new GetSecretValueCommand({ SecretId: secretArn })
    );

    if (!secretResponse.SecretString) {
      throw new Error('Secret value is empty');
    }

    const secret = JSON.parse(secretResponse.SecretString);
    const proxyEndpoint = process.env.DATABASE_PROXY_ENDPOINT;
    const dbName = process.env.DATABASE_NAME || 'appdb';

    // Build connection URL
    const databaseUrl = `postgresql://${secret.username}:${encodeURIComponent(secret.password)}@${proxyEndpoint}:5432/${dbName}?schema=public`;

    // Set environment for Prisma
    process.env.DATABASE_URL = databaseUrl;

    let command: string;
    switch (action) {
      case 'status':
        command = 'npx prisma migrate status';
        break;
      case 'reset':
        // ⚠️ DANGEROUS: Only for dev environments
        if (process.env.ALLOW_RESET !== 'true') {
          throw new Error('Reset is disabled. Set ALLOW_RESET=true to enable.');
        }
        command = 'npx prisma migrate reset --force';
        break;
      case 'deploy':
      default:
        command = 'npx prisma migrate deploy';
        break;
    }

    console.log(`Executing: ${command}`);

    const output = execSync(command, {
      cwd: process.env.LAMBDA_TASK_ROOT,
      encoding: 'utf-8',
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
      },
    });

    console.log('Migration output:', output);

    return {
      success: true,
      action,
      output,
    };
  } catch (error) {
    console.error('Migration failed:', error);

    return {
      success: false,
      action,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
