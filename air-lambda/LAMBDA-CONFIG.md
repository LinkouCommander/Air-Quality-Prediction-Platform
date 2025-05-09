# Lambda Function Configuration Guide

To address OpenAQ API rate limits and ensure stable Lambda execution, please configure your Lambda function as follows:

## Function Configuration

1. **Timeout Setting:**
   - Set to **5–10 minutes** (300–600 seconds)
   - Path: Lambda Console > Configuration > General configuration > Edit > Timeout

2. **Memory Allocation:**
   - Set to **512MB** (current default is sufficient)
   - If you still encounter timeouts, consider increasing to 1024MB

3. **Concurrency Setting:**
   - Optional: Set provisioned concurrency to 2–3 to reduce cold start time
   - Path: Lambda Console > Configuration > Concurrency > Edit

## Environment Variable Configuration

Ensure the following environment variables are set correctly:
```
MONGO_URI=<MongoDB connection string>
OPENAQ_API_KEY=<OpenAQ API key>
MAX_STATIONS_PER_RUN=50
STATIONS_OFFSET=0
```

### Pagination Handling

The function now supports paginated processing of stations, controlled by these environment variables:

- `MAX_STATIONS_PER_RUN`: Maximum number of stations processed per execution (recommended: 50)
- `STATIONS_OFFSET`: The starting station index for this run (initially 0)

**Usage Suggestions:**
1. For the first run, set `STATIONS_OFFSET=0` and `MAX_STATIONS_PER_RUN=50`
2. Check the function logs for the "next run" offset suggestion and record the displayed offset value
3. Create two or more Lambda functions (using the same code), each with a different offset range
4. For example, if you have 400 stations, create 8 functions, each processing 50 stations:
   - Function 1: STATIONS_OFFSET=0, MAX_STATIONS_PER_RUN=50
   - Function 2: STATIONS_OFFSET=50, MAX_STATIONS_PER_RUN=50
   - Function 3: STATIONS_OFFSET=100, MAX_STATIONS_PER_RUN=50
   - ...and so on

You can set the same trigger time for each function, and they will automatically share the workload.

## Steps to Create Multiple Lambda Functions

1. Create the first Lambda function, upload the code, and test it
2. Use the AWS Console to duplicate the function (Actions > Create new version)
3. Change the environment variables for each duplicate, setting a different `STATIONS_OFFSET`
4. Add the same trigger to each function (recommended: run on the hour)

## Progress Tracking

The function records progress in the `lambjobprogress` collection in your database. You can query this collection to monitor the execution status of each function.

## Additional Solutions for Timeout Issues

If you still encounter timeouts after adjustments, consider:

1. **Further reduce the number of stations per run:**
   - Set `MAX_STATIONS_PER_RUN` to a smaller value, such as 20 or 10

2. **Use an SQS Queue:**
   - Create an SQS queue
   - The main function only sends station IDs to the queue
   - Another function receives messages from the queue and processes individual stations

## Logging and Monitoring

Set up CloudWatch alarms to monitor:
- Function error rate
- Function timeouts
- Function duration

## Other Recommendations

- Rotate API keys regularly
- Contact OpenAQ to inquire about API rate limits or request higher quotas
- Consider implementing a data caching strategy to reduce API dependency 