import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';

/**
 * VPC Stack Configuration
 *
 * Creates a VPC optimized for cost in development while supporting
 * the full API Gateway + Lambda + Aurora architecture.
 */
export interface VpcStackProps extends cdk.NestedStackProps {
  /**
   * Use NAT Instance instead of NAT Gateway for cost savings
   * NAT Instance: ~$3/month vs NAT Gateway: ~$32/month
   * @default true
   */
  useNatInstance?: boolean;

  /**
   * Number of Availability Zones
   * For dev: 2 AZs (minimum for Aurora)
   * For prod: 2-3 AZs recommended
   * @default 2
   */
  maxAzs?: number;
}

export class VpcStack extends cdk.NestedStack {
  public readonly vpc: ec2.Vpc;
  public readonly lambdaSecurityGroup: ec2.SecurityGroup;
  public readonly rdsProxySecurityGroup: ec2.SecurityGroup;
  public readonly auroraSecurityGroup: ec2.SecurityGroup;

  constructor(scope: Construct, id: string, props?: VpcStackProps) {
    super(scope, id, props);

    const useNatInstance = props?.useNatInstance ?? true;
    const maxAzs = props?.maxAzs ?? 2;

    // Create VPC with public, private, and isolated subnets
    this.vpc = new ec2.Vpc(this, 'AppVpc', {
      ipAddresses: ec2.IpAddresses.cidr('10.0.0.0/16'),
      maxAzs,

      // Subnet configuration
      subnetConfiguration: [
        {
          name: 'Public',
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24,
          // Public subnets for NAT Instance/Gateway and bastion (if needed)
        },
        {
          name: 'Private',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
          cidrMask: 24,
          // Private subnets for Lambda functions (need internet via NAT)
        },
        {
          name: 'Isolated',
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
          cidrMask: 24,
          // Isolated subnets for Aurora (no internet access)
        },
      ],

      // NAT configuration - use NAT Instance for cost savings in dev
      natGateways: useNatInstance ? 0 : 1,
      natGatewayProvider: useNatInstance
        ? undefined
        : ec2.NatProvider.gateway(),
    });

    // If using NAT Instance, create it manually
    if (useNatInstance) {
      this.createNatInstance();
    }

    // Create Security Groups
    this.createSecurityGroups();

    // Add VPC Flow Logs for debugging (optional, costs extra)
    // this.vpc.addFlowLog('FlowLog', {
    //   destination: ec2.FlowLogDestination.toCloudWatchLogs(),
    //   trafficType: ec2.FlowLogTrafficType.ALL,
    // });

    // Outputs
    new cdk.CfnOutput(this, 'VpcId', {
      value: this.vpc.vpcId,
      description: 'VPC ID',
    });

    new cdk.CfnOutput(this, 'PrivateSubnets', {
      value: this.vpc.privateSubnets.map(s => s.subnetId).join(','),
      description: 'Private Subnet IDs (for Lambda)',
    });

    new cdk.CfnOutput(this, 'IsolatedSubnets', {
      value: this.vpc.isolatedSubnets.map(s => s.subnetId).join(','),
      description: 'Isolated Subnet IDs (for Aurora)',
    });
  }

  /**
   * Creates a NAT Instance using Amazon Linux 2023 with iptables NAT
   * This is significantly cheaper than NAT Gateway for dev/test workloads
   */
  private createNatInstance(): void {
    // Security group for NAT Instance
    const natSecurityGroup = new ec2.SecurityGroup(this, 'NatSecurityGroup', {
      vpc: this.vpc,
      description: 'Security group for NAT Instance',
      allowAllOutbound: true,
    });

    // Allow inbound traffic from private subnets
    this.vpc.privateSubnets.forEach((subnet, index) => {
      natSecurityGroup.addIngressRule(
        ec2.Peer.ipv4(subnet.ipv4CidrBlock),
        ec2.Port.allTraffic(),
        `Allow all traffic from private subnet ${index + 1}`
      );
    });

    // Create NAT Instance
    const natInstance = new ec2.Instance(this, 'NatInstance', {
      vpc: this.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.T4G,
        ec2.InstanceSize.NANO
      ),
      machineImage: ec2.MachineImage.latestAmazonLinux2023({
        cpuType: ec2.AmazonLinuxCpuType.ARM_64,
      }),
      securityGroup: natSecurityGroup,
      sourceDestCheck: false, // Required for NAT
      associatePublicIpAddress: true,
    });

    // User data to configure NAT
    natInstance.addUserData(
      '#!/bin/bash',
      'yum install -y iptables-services',
      'systemctl enable iptables',
      'systemctl start iptables',
      'echo 1 > /proc/sys/net/ipv4/ip_forward',
      'echo "net.ipv4.ip_forward = 1" >> /etc/sysctl.conf',
      'iptables -t nat -A POSTROUTING -o ens5 -j MASQUERADE',
      'iptables -A FORWARD -i ens5 -o ens5 -m state --state RELATED,ESTABLISHED -j ACCEPT',
      'iptables -A FORWARD -i ens5 -o ens5 -j ACCEPT',
      'service iptables save'
    );

    // Add route from private subnets to NAT Instance
    this.vpc.privateSubnets.forEach((subnet, index) => {
      new ec2.CfnRoute(this, `PrivateRoute${index}`, {
        routeTableId: subnet.routeTable.routeTableId,
        destinationCidrBlock: '0.0.0.0/0',
        instanceId: natInstance.instanceId,
      });
    });

    new cdk.CfnOutput(this, 'NatInstanceId', {
      value: natInstance.instanceId,
      description: 'NAT Instance ID',
    });
  }

  /**
   * Creates security groups for the application tiers
   */
  private createSecurityGroups(): void {
    // Security Group for Lambda functions
    this.lambdaSecurityGroup = new ec2.SecurityGroup(this, 'LambdaSecurityGroup', {
      vpc: this.vpc,
      description: 'Security group for Lambda functions',
      allowAllOutbound: true, // Lambda needs outbound for Secrets Manager, etc.
    });

    // Security Group for RDS Proxy
    this.rdsProxySecurityGroup = new ec2.SecurityGroup(this, 'RdsProxySecurityGroup', {
      vpc: this.vpc,
      description: 'Security group for RDS Proxy',
      allowAllOutbound: false,
    });

    // Allow Lambda to connect to RDS Proxy
    this.rdsProxySecurityGroup.addIngressRule(
      this.lambdaSecurityGroup,
      ec2.Port.tcp(5432),
      'Allow PostgreSQL from Lambda'
    );

    // Security Group for Aurora
    this.auroraSecurityGroup = new ec2.SecurityGroup(this, 'AuroraSecurityGroup', {
      vpc: this.vpc,
      description: 'Security group for Aurora PostgreSQL',
      allowAllOutbound: false,
    });

    // Allow RDS Proxy to connect to Aurora
    this.auroraSecurityGroup.addIngressRule(
      this.rdsProxySecurityGroup,
      ec2.Port.tcp(5432),
      'Allow PostgreSQL from RDS Proxy'
    );

    // Allow RDS Proxy outbound to Aurora
    this.rdsProxySecurityGroup.addEgressRule(
      this.auroraSecurityGroup,
      ec2.Port.tcp(5432),
      'Allow PostgreSQL to Aurora'
    );

    // Tags for easy identification
    cdk.Tags.of(this.lambdaSecurityGroup).add('Name', 'Lambda-SG');
    cdk.Tags.of(this.rdsProxySecurityGroup).add('Name', 'RDSProxy-SG');
    cdk.Tags.of(this.auroraSecurityGroup).add('Name', 'Aurora-SG');
  }
}
