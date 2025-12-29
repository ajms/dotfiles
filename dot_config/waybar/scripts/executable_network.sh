#!/bin/bash
# Network monitor with color classes based on download speed
# green > 500KB/s, yellow > 1MB/s, orange > 10MB/s

STATE_FILE="/tmp/waybar_network_state"

get_rx_bytes() {
    cat /sys/class/net/*/statistics/rx_bytes 2>/dev/null | awk '{sum+=$1} END {print sum}'
}

get_tx_bytes() {
    cat /sys/class/net/*/statistics/tx_bytes 2>/dev/null | awk '{sum+=$1} END {print sum}'
}

format_speed() {
    local bytes=$1
    if [ "$bytes" -ge 1073741824 ]; then
        awk "BEGIN {printf \"%.1fG\", $bytes / 1073741824}"
    elif [ "$bytes" -ge 1048576 ]; then
        awk "BEGIN {printf \"%.1fM\", $bytes / 1048576}"
    elif [ "$bytes" -ge 1024 ]; then
        awk "BEGIN {printf \"%.0fK\", $bytes / 1024}"
    else
        echo "${bytes}B"
    fi
}

curr_rx=$(get_rx_bytes)
curr_tx=$(get_tx_bytes)
curr_time=$(date +%s%N)

if [ -f "$STATE_FILE" ]; then
    read -r prev_rx prev_tx prev_time < "$STATE_FILE"

    # Calculate time difference in seconds (nanosecond precision)
    time_diff=$(awk "BEGIN {printf \"%.2f\", ($curr_time - $prev_time) / 1000000000}")

    if [ "$(echo "$time_diff > 0" | bc)" -eq 1 ]; then
        rx_speed=$(awk "BEGIN {printf \"%.0f\", ($curr_rx - $prev_rx) / $time_diff}")
        tx_speed=$(awk "BEGIN {printf \"%.0f\", ($curr_tx - $prev_tx) / $time_diff}")
    else
        rx_speed=0
        tx_speed=0
    fi
else
    rx_speed=0
    tx_speed=0
fi

# Save current state
echo "$curr_rx $curr_tx $curr_time" > "$STATE_FILE"

rx_formatted=$(format_speed $rx_speed)
tx_formatted=$(format_speed $tx_speed)

# Determine class based on download speed (bytes/s)
if [ "$rx_speed" -ge 10485760 ]; then  # > 10MB/s
    class="fast"
elif [ "$rx_speed" -ge 1048576 ]; then  # > 1MB/s
    class="moderate"
elif [ "$rx_speed" -ge 512000 ]; then   # > 500KB/s
    class="active"
else
    class=""
fi

echo "{\"text\": \"↓${rx_formatted} ↑${tx_formatted} \", \"tooltip\": \"Download: ${rx_formatted}/s\\nUpload: ${tx_formatted}/s\", \"class\": \"$class\"}"
