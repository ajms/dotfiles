#!/bin/sh

A2DP_SINK_UUID=0000110b-0000-1000-8000-00805f9b34fb

card_field() {
    pactl list cards | awk -v card="$1" -v key="$2" '
        $1 == "Name:" { in_card = ($2 == card) }
        in_card && key == "active" && /Active Profile:/ { print $3; exit }
        in_card && key == "path" && $1 == "bluez.path" { gsub(/"/, "", $3); print $3; exit }
        in_card && $1 == key":" { print ($NF == "yes)" ? "yes" : "no"); exit }'
}

ensure_a2dp() {
    card=$1
    # devices without an a2dp_sink profile (e.g. phones) are left alone
    [ -n "$(card_field "$card" a2dp_sink)" ] || return
    attempt=0
    while [ $attempt -lt 20 ]; do
        if [ "$(card_field "$card" a2dp_sink)" = yes ]; then
            if [ "$(card_field "$card" active)" != a2dp_sink ]; then
                pactl set-card-profile "$card" a2dp_sink
            fi
            return
        fi
        # bluetoothd does not retry a2dp after "resource busy", so ask it again
        if [ $attempt -eq 5 ] || [ $attempt -eq 12 ]; then
            busctl call org.bluez "$(card_field "$card" path)" org.bluez.Device1 \
                ConnectProfile s "$A2DP_SINK_UUID" >/dev/null 2>&1
        fi
        attempt=$((attempt + 1))
        sleep 1
    done
}

pactl list cards short | awk '$2 ~ /^bluez_card\./ {print $2}' | while read -r card; do
    ensure_a2dp "$card" &
done

pactl subscribe | while read -r line; do
    case "$line" in
        "Event 'new' on card #"*)
            index=${line##*#}
            card=$(pactl list cards short | awk -v i="$index" '$1 == i {print $2}')
            case "$card" in
                bluez_card.*) ensure_a2dp "$card" & ;;
            esac
            ;;
    esac
done
