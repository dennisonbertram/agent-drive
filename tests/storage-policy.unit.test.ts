import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const template = JSON.parse(readFileSync(resolve('infra/storage.cfn.json'), 'utf8'));

describe('production storage policy', () => {
  it('blocks public access and non-TLS requests on both retained buckets', () => {
    for (const name of ['Data', 'Logs']) {
      const bucket = template.Resources[`${name}Bucket`];
      expect(bucket.DeletionPolicy).toBe('Retain');
      expect(bucket.Properties.PublicAccessBlockConfiguration).toEqual({
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      });
      expect(bucket.Properties.OwnershipControls.Rules).toEqual([
        { ObjectOwnership: 'BucketOwnerEnforced' },
      ]);
      expect(
        template.Resources[`${name}BucketPolicy`].Properties.PolicyDocument.Statement[0],
      ).toMatchObject({
        Effect: 'Deny',
        Principal: '*',
        Action: 's3:*',
        Condition: {
          Bool: { 'aws:SecureTransport': 'false', 'aws:PrincipalIsAWSService': 'false' },
        },
      });
    }
  });

  it('expires only staging bytes, leaves committed versions alone, and restricts CORS', () => {
    const bucket = template.Resources.DataBucket.Properties;
    expect(bucket.VersioningConfiguration).toBeUndefined();
    for (const rule of bucket.LifecycleConfiguration.Rules) expect(rule.Prefix).toBe('staging/');
    expect(bucket.LifecycleConfiguration.Rules[0]).toMatchObject({
      ExpirationInDays: 1,
      NoncurrentVersionExpiration: { NoncurrentDays: 1 },
    });
    expect(bucket.CorsConfiguration.CorsRules[0].AllowedOrigins).toEqual([{ Ref: 'PublicOrigin' }]);
    expect(bucket.CorsConfiguration.CorsRules[0].AllowedMethods).toEqual(['GET', 'HEAD', 'PUT']);
    const origin = new RegExp(`^(?:${template.Parameters.PublicOrigin.AllowedPattern})$`);
    expect(origin.test('https://drive.example.com')).toBe(true);
    for (const value of [
      '*',
      'http://drive.example.com',
      'https://drive.example.com/',
      'https://*.example.com',
    ])
      expect(origin.test(value)).toBe(false);
  });

  it('restricts runtime access to application prefixes and log reads', () => {
    const policy = template.Resources.RuntimeStoragePolicy.Properties.PolicyDocument.Statement;
    expect(policy[0].Condition.StringLike['s3:prefix']).toEqual(['objects/*', 'staging/*']);
    expect(policy[1].Action).toContain('s3:DeleteObjectVersion');
    expect(policy[1].Resource).toEqual([
      { 'Fn::Sub': '${DataBucket.Arn}/objects/*' },
      { 'Fn::Sub': '${DataBucket.Arn}/staging/*' },
    ]);
    expect(policy[3].Action).toBe('s3:GetObject');
    expect(JSON.stringify(policy)).not.toContain('s3:*');
    const logs = template.Resources.LogsBucketPolicy.Properties.PolicyDocument.Statement[1];
    expect(logs.Principal).toEqual({ Service: 'logging.s3.amazonaws.com' });
    expect(logs.Condition.StringEquals['aws:SourceAccount']).toEqual({ Ref: 'AWS::AccountId' });
    expect(logs.Condition.ArnEquals['aws:SourceArn']).toEqual({
      'Fn::Sub': 'arn:${AWS::Partition}:s3:::${DataBucketName}',
    });
  });
});
