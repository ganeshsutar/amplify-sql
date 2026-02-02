import * as cdk from 'aws-cdk-lib';
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as apigatewayv2Integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as apigatewayv2Authorizers from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { Construct } from 'constructs';

/**
 * API Gateway Stack Configuration
 *
 * Creates an HTTP API with Cognito JWT authorization that routes
 * all requests to the Lambda function.
 */
export interface ApiGatewayStackProps extends cdk.NestedStackProps {
  /**
   * Lambda function to handle API requests
   */
  apiFunction: lambda.IFunction;

  /**
   * Cognito User Pool for JWT authorization
   */
  userPool: cognito.IUserPool;

  /**
   * Cognito User Pool Client
   */
  userPoolClient: cognito.IUserPoolClient;

  /**
   * Allowed origins for CORS
   * @default ['*']
   */
  allowedOrigins?: string[];

  /**
   * API stage name
   * @default 'api'
   */
  stageName?: string;
}

export class ApiGatewayStack extends cdk.NestedStack {
  public readonly httpApi: apigatewayv2.HttpApi;
  public readonly apiEndpoint: string;

  constructor(scope: Construct, id: string, props: ApiGatewayStackProps) {
    super(scope, id, props);

    const allowedOrigins = props.allowedOrigins ?? ['*'];
    const stageName = props.stageName ?? 'api';

    // Create JWT Authorizer using Cognito User Pool
    const jwtAuthorizer = new apigatewayv2Authorizers.HttpJwtAuthorizer(
      'CognitoAuthorizer',
      `https://cognito-idp.${cdk.Stack.of(this).region}.amazonaws.com/${props.userPool.userPoolId}`,
      {
        authorizerName: 'CognitoJwtAuthorizer',
        identitySource: ['$request.header.Authorization'],
        jwtAudience: [props.userPoolClient.userPoolClientId],
      }
    );

    // Create Lambda integration
    const lambdaIntegration = new apigatewayv2Integrations.HttpLambdaIntegration(
      'LambdaIntegration',
      props.apiFunction,
      {
        payloadFormatVersion: apigatewayv2.PayloadFormatVersion.VERSION_2_0,
      }
    );

    // Create HTTP API
    this.httpApi = new apigatewayv2.HttpApi(this, 'HttpApi', {
      apiName: 'amplify-sql-api',
      description: 'HTTP API for Amplify SQL application',

      // CORS configuration
      corsPreflight: {
        allowOrigins: allowedOrigins,
        allowMethods: [
          apigatewayv2.CorsHttpMethod.GET,
          apigatewayv2.CorsHttpMethod.POST,
          apigatewayv2.CorsHttpMethod.PUT,
          apigatewayv2.CorsHttpMethod.PATCH,
          apigatewayv2.CorsHttpMethod.DELETE,
          apigatewayv2.CorsHttpMethod.OPTIONS,
        ],
        allowHeaders: [
          'Content-Type',
          'Authorization',
          'X-Amz-Date',
          'X-Api-Key',
          'X-Amz-Security-Token',
          'X-Requested-With',
        ],
        allowCredentials: true,
        maxAge: cdk.Duration.hours(1),
      },

      // Disable default endpoint if using custom domain
      disableExecuteApiEndpoint: false,
    });

    // Add routes with JWT authorization

    // Health check route (no auth required)
    this.httpApi.addRoutes({
      path: '/health',
      methods: [apigatewayv2.HttpMethod.GET],
      integration: lambdaIntegration,
      // No authorizer for health check
    });

    // API routes (auth required)
    const apiRoutes = [
      // Todos (legacy support)
      { path: '/api/todos', methods: [apigatewayv2.HttpMethod.GET, apigatewayv2.HttpMethod.POST] },
      { path: '/api/todos/{id}', methods: [apigatewayv2.HttpMethod.GET, apigatewayv2.HttpMethod.PUT, apigatewayv2.HttpMethod.DELETE] },

      // Users
      { path: '/api/users', methods: [apigatewayv2.HttpMethod.GET, apigatewayv2.HttpMethod.POST] },
      { path: '/api/users/{id}', methods: [apigatewayv2.HttpMethod.GET, apigatewayv2.HttpMethod.PUT, apigatewayv2.HttpMethod.DELETE] },
      { path: '/api/users/me', methods: [apigatewayv2.HttpMethod.GET, apigatewayv2.HttpMethod.PUT] },

      // Organizations
      { path: '/api/organizations', methods: [apigatewayv2.HttpMethod.GET, apigatewayv2.HttpMethod.POST] },
      { path: '/api/organizations/{id}', methods: [apigatewayv2.HttpMethod.GET, apigatewayv2.HttpMethod.PUT, apigatewayv2.HttpMethod.DELETE] },

      // Roles
      { path: '/api/roles', methods: [apigatewayv2.HttpMethod.GET, apigatewayv2.HttpMethod.POST] },
      { path: '/api/roles/{id}', methods: [apigatewayv2.HttpMethod.GET, apigatewayv2.HttpMethod.PUT, apigatewayv2.HttpMethod.DELETE] },

      // Products
      { path: '/api/products', methods: [apigatewayv2.HttpMethod.GET, apigatewayv2.HttpMethod.POST] },
      { path: '/api/products/{id}', methods: [apigatewayv2.HttpMethod.GET, apigatewayv2.HttpMethod.PUT, apigatewayv2.HttpMethod.DELETE] },

      // Categories
      { path: '/api/categories', methods: [apigatewayv2.HttpMethod.GET, apigatewayv2.HttpMethod.POST] },
      { path: '/api/categories/{id}', methods: [apigatewayv2.HttpMethod.GET, apigatewayv2.HttpMethod.PUT, apigatewayv2.HttpMethod.DELETE] },

      // Warehouses
      { path: '/api/warehouses', methods: [apigatewayv2.HttpMethod.GET, apigatewayv2.HttpMethod.POST] },
      { path: '/api/warehouses/{id}', methods: [apigatewayv2.HttpMethod.GET, apigatewayv2.HttpMethod.PUT, apigatewayv2.HttpMethod.DELETE] },

      // Stock
      { path: '/api/stock', methods: [apigatewayv2.HttpMethod.GET] },
      { path: '/api/stock/{productId}/{warehouseId}', methods: [apigatewayv2.HttpMethod.GET, apigatewayv2.HttpMethod.PUT] },

      // Suppliers
      { path: '/api/suppliers', methods: [apigatewayv2.HttpMethod.GET, apigatewayv2.HttpMethod.POST] },
      { path: '/api/suppliers/{id}', methods: [apigatewayv2.HttpMethod.GET, apigatewayv2.HttpMethod.PUT, apigatewayv2.HttpMethod.DELETE] },

      // Purchase Orders
      { path: '/api/purchase-orders', methods: [apigatewayv2.HttpMethod.GET, apigatewayv2.HttpMethod.POST] },
      { path: '/api/purchase-orders/{id}', methods: [apigatewayv2.HttpMethod.GET, apigatewayv2.HttpMethod.PUT, apigatewayv2.HttpMethod.DELETE] },

      // Audit Logs (read-only)
      { path: '/api/audit-logs', methods: [apigatewayv2.HttpMethod.GET] },
      { path: '/api/audit-logs/{id}', methods: [apigatewayv2.HttpMethod.GET] },
    ];

    // Add each route with authorization
    apiRoutes.forEach((route) => {
      route.methods.forEach((method) => {
        this.httpApi.addRoutes({
          path: route.path,
          methods: [method],
          integration: lambdaIntegration,
          authorizer: jwtAuthorizer,
        });
      });
    });

    // Catch-all route for any other API paths (with auth)
    this.httpApi.addRoutes({
      path: '/api/{proxy+}',
      methods: [apigatewayv2.HttpMethod.ANY],
      integration: lambdaIntegration,
      authorizer: jwtAuthorizer,
    });

    // Store the API endpoint
    this.apiEndpoint = this.httpApi.apiEndpoint;

    // Outputs
    new cdk.CfnOutput(this, 'ApiEndpoint', {
      value: this.apiEndpoint,
      description: 'HTTP API Endpoint URL',
    });

    new cdk.CfnOutput(this, 'ApiId', {
      value: this.httpApi.apiId,
      description: 'HTTP API ID',
    });

    new cdk.CfnOutput(this, 'AuthorizerId', {
      value: jwtAuthorizer.authorizerId,
      description: 'JWT Authorizer ID',
    });
  }
}
