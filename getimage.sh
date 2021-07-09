#!/bin/sh
set -eu
if [ $# -le 2 ]; then
    echo Usage: getimage.sh STUDY SERIES IMAGE
    exit 1
fi
STUDY=$1
SERIES=$2
IMAGE=$3
echo REtrieving from http://127.0.0.1:3000/files/$STUDY/$SERIES/$IMAGE
curl -si http://127.0.0.1:3000/files/$STUDY/$SERIES/$IMAGE
