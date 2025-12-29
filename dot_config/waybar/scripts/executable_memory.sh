#!/bin/bash
# Memory monitor with color classes based on usage percentage
# yellow > 50%, red > 80%

read -r total used <<< $(free -b | awk '/Mem:/ {print $2, $3}')
percent=$((used * 100 / total))
used_gb=$(awk "BEGIN {printf \"%.1f\", $used / 1073741824}")

if [ "$percent" -ge 80 ]; then
    class="critical"
elif [ "$percent" -ge 50 ]; then
    class="warning"
else
    class=""
fi

echo "{\"text\": \"${used_gb} Gb 󰍛\", \"tooltip\": \"Memory: ${used_gb} Gb (${percent}%)\", \"class\": \"$class\", \"percentage\": $percent}"
