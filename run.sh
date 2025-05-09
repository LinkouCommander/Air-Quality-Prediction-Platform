#!/bin/bash

# ensure the directory is correct
cd "$(dirname "$0")"

# install the dependencies
echo "Installing dependencies..."
npm install

# run the generate script
echo "Starting to generate historical data..."
npm run generate

# check the result
if [ $? -eq 0 ]; then
  echo "✅ Historical data generation completed!"
  echo "Check data_generation.log for details"
else
  echo "❌ Error occurred during generation, please check the log file for details"
fi 