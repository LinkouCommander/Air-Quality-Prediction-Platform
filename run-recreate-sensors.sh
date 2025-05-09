#!/bin/bash

# ensure the directory is correct
cd "$(dirname "$0")"

echo "==== Start to rebuild sensors ===="
echo "This script will delete all existing sensors and recreate them based on stations"
echo "Please ensure the MONGO_URI in the .env file is correctly set"
echo "The script will run node recreate-sensors.js"

# ask the user to confirm
read -p "Are you sure to continue? (y/n): " confirm
if [ "$confirm" != "y" ]; then
  echo "Operation cancelled"
  exit 0
fi

# check the node and npm
if ! command -v node &> /dev/null; then
  echo "Error: node command not found, please install Node.js"
  exit 1
fi

# run the script
echo "Starting to execute the sensor reconstruction..."
node recreate-sensors.js

# check the result
if [ $? -eq 0 ]; then
  echo "✅ Sensor reconstruction completed!"
else
  echo "❌ Error occurred during reconstruction, please check the log for details"
fi 