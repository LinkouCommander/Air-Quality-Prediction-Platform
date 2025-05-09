# Los Angeles Air Quality Data Collection Lambda Deployment Guide

This document provides detailed steps for deploying the Los Angeles air quality data collection Lambda function to AWS.

## Prerequisites

Before deployment, please ensure you have:

1. A valid AWS account with permissions to create Lambda functions
2. A valid OpenAQ API key
3. A configured MongoDB database and connection string
4. Node.js and npm installed (for dependency installation)
5. ZIP utility installed (for creating deployment packages)

## Deployment Steps

### 1. Create Lambda Deployment Package

In your terminal, run:

```bash
# Enter the air-lambda directory
cd air-lambda

# Install dependencies
npm install

# If you have permission, use the provided script to create the package
chmod +x create-lambda-package.sh
./create-lambda-package.sh

# Or manually create the ZIP package
zip -r la-hourly-lambda.zip index.js la-hourly-sync.js package.json node_modules/
```

This will create a deployment package named `la-hourly-lambda.zip`.

### 2. Create Lambda Function in AWS Console

1. Log in to the AWS Console
2. Go to the Lambda service
3. Click "Create function"
4. Choose "Author from scratch"
5. Set basic information:
   - Function name: `LAHourlyAirQualitySync` (or any name you prefer)
   - Runtime: `Node.js 22.x` or a compatible version
   - Architecture: `x86_64`
   - Execution role: Create a new role or use an existing one (must have basic Lambda execution permissions)
6. Click "Create function"

### 3. Upload Deployment Package

1. On the function page, scroll to the "Code source" section
2. Click the "Upload from" dropdown, select ".zip file"
3. Upload the `la-hourly-lambda.zip` file you just created
4. Click "Save"

### 4. Configure Environment Variables

1. On the function page, go to the "Configuration" tab
2. Select "Environment variables"
3. Click "Edit"
4. Add the following environment variables:
   - Key: `MONGO_URI`, Value: your MongoDB connection string
   - Key: `OPENAQ_API_KEY`, Value: your OpenAQ API key
5. Click "Save"

### 5. Configure Function Settings

1. In the "Configuration" tab, select "General configuration"
2. Click "Edit"
3. Set the following parameters:
   - Memory: at least 512MB recommended
   - Timeout: at least 30 seconds, preferably 60–300 seconds
   - Handler: `index.handler` (default)
4. Click "Save"

### 6. Set Up Trigger

1. On the function page, click "Add trigger"
2. Select "EventBridge (CloudWatch Events)"
3. Create a new rule:
   - Rule name: `HourlyAirQualitySync` (or any name you prefer)
   - Rule type: "Schedule expression"
   - Schedule expression: `cron(0 * * * ? *)` (runs every hour on the hour)
4. Click "Add"

### 7. Test the Function

1. On the function page, go to the "Test" tab
2. Create a new test event:
   - Event name: `TestEvent`
   - Event JSON: `{}` (empty object is fine)
3. Click the "Test" button to manually trigger the function
4. Check the execution result and logs

## Monitoring & Troubleshooting

### View Logs

1. On the function page, go to the "Monitor" tab
2. Click "View logs in CloudWatch" for detailed logs
3. Check for errors or warnings

### Common Issues

1. **Function timeout**: Increase the timeout, or reduce the number of stations processed per batch
2. **Insufficient memory**: Increase the function's memory allocation
3. **Database connection failure**:
   - Check if the MongoDB connection string is correct
   - Ensure the Lambda function has network access to the database (if inside a VPC)
4. **OpenAQ API errors**:
   - Check if the API key is valid
   - Review API rate limits; you may need to adjust request frequency

## Optimization Suggestions

1. **Performance optimization**:
   - Adjust `batchSize` in the code based on the number of stations
   - Tune Lambda memory and timeout settings based on processing time

2. **Cost optimization**:
   - Monitor execution time and adjust memory allocation as needed
   - Consider running the function only during working hours instead of every hour

3. **Data security**:
   - Use AWS Secrets Manager or Parameter Store for sensitive information
   - Rotate API keys and database credentials regularly

## Appendix

### Setting Up Local Development

1. Clone the repository
2. Create a `.env` file in the air-lambda directory with:
   ```
   MONGO_URI=your MongoDB connection string
   OPENAQ_API_KEY=your OpenAQ API key
   ```
3. Run `npm install` to install dependencies
4. Use `node la-hourly-sync-local.js` for local testing

### Automated Deployment

You can use AWS CLI to automate Lambda deployment:

```bash
# Update Lambda function code
aws lambda update-function-code \
  --function-name LAHourlyAirQualitySync \
  --zip-file fileb://la-hourly-lambda.zip

# Update environment variables
aws lambda update-function-configuration \
  --function-name LAHourlyAirQualitySync \
  --environment "Variables={MONGO_URI=mongodb://...,OPENAQ_API_KEY=your-api-key}"
``` 