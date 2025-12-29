#!/bin/bash
# Disk monitor with color classes based on usage percentage
# red > 80%

path="${1:-/}"
name="${2:-disk}"

read -r percent used total <<< $(df -h "$path" | awk 'NR==2 {gsub(/%/,"",$5); print $5, $3, $2}')

if [ "$percent" -ge 80 ]; then
    class="critical"
else
    class=""
fi

echo "{\"text\": \"${percent}% 󰋊\", \"tooltip\": \"$name: ${used}/${total} (${percent}%)\", \"class\": \"$class\", \"percentage\": $percent}"
