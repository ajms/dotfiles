#!/bin/bash

# Function to print the usage instructions
usage() {
    echo "Usage: $0 YYYY-MM-DD"
    exit 1
}

# Check if a date argument is provided
if [ $# -ne 1 ]; then
    usage
fi

# Convert the provided cutoff date to Unix timestamp
CUTOFF_DATE="$1"
CUTOFF_TIMESTAMP=$(date -d "$CUTOFF_DATE" +%s 2>/dev/null)

# Validate that the input date was parsed correctly
if [ $? -ne 0 ]; then
    echo "Invalid date format. Please provide the date in YYYY-MM-DD format."
    usage
fi

# Loop through all local branches except the main branch (adjust the branch name as needed)
for branch in $(git for-each-ref --format='%(refname:short)' refs/heads/); do
    # Skip the main branch or any other branch you don't want to delete
    if [ "$branch" == "main" ]; then
        continue
    fi

    # Get the latest commit date for the branch in Unix timestamp format
    LAST_COMMIT_TIMESTAMP=$(git log -1 --format=%ct "$branch")

    # Compare the commit date with the cutoff date and delete the branch if it's older
    if [ "$LAST_COMMIT_TIMESTAMP" -lt "$CUTOFF_TIMESTAMP" ]; then
        echo "Deleting branch: $branch"
        git branch -D "$branch"
    fi
done
