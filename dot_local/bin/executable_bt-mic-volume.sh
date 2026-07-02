#!/bin/sh

set_bt_mic_volumes() {
    # wait for the headset's HFP gain report, which would override us
    sleep 2
    pactl list sources short | awk '{print $2}' | grep '^bluez_source' | while read -r name; do
        if [ "$(pactl get-source-mute "$name")" = "Mute: no" ]; then
            pactl set-source-volume "$name" 100%
        fi
    done
}

pactl subscribe | while read -r line; do
    case "$line" in
        "Event 'new' on source #"*) set_bt_mic_volumes ;;
    esac
done
