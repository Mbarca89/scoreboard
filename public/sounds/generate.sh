#!/bin/sh

set -e

echo "sure? (Ctrl-C to abort)"
read

voice=Samantha

say -v $voice -o 1-minute.aiff "1 minute"
say -v $voice -o 2-minutes.aiff "2 minutes"
say -v $voice -o 3-minutes.aiff "3 minutes"
say -v $voice -o 4-minutes.aiff "4 minutes"
say -v $voice -o 5-minutes.aiff "5 minutes"
say -v $voice -o 10-seconds.aiff "10 seconds"
say -v $voice -o 20-seconds.aiff "20 seconds"
say -v $voice -o 30-seconds.aiff "30 seconds"
say -v $voice -o 60-seconds.aiff "60 seconds"
say -v $voice -o base.aiff "base"
say -v $voice -o game-finished.aiff "Game finished"
say -v $voice -o game-start.aiff "Game On"
say -v $voice -o game-stop.aiff "Game Stopped"
say -v $voice -o game-time-finished.aiff "Game Time Finished"
say -v $voice -o no-points.aiff "No points"
say -v $voice -o overtime.aiff "Overtime"
say -v $voice -o point-approved.aiff "Point Approved"
say -v $voice -o reverse-point.aiff "Reverse Point"
say -v $voice -o time-over.aiff "Time is over"
say -v $voice -o timeout.aiff "Timeout"
say -v $voice -o towel.aiff "Towel"
say -v $voice -o concede.aiff "Concede"

sox 1-minute.aiff 1-minute.wav
sox 10-seconds.aiff 10-seconds.wav
sox 2-minutes.aiff 2-minutes.wav
sox 20-seconds.aiff 20-seconds.wav
sox 3-minutes.aiff 3-minutes.wav
sox 30-seconds.aiff 30-seconds.wav
sox 4-minutes.aiff 4-minutes.wav
sox 5-minutes.aiff 5-minutes.wav
sox 60-seconds.aiff 60-seconds.wav
sox base.aiff base.wav
sox game-finished.aiff game-finished.wav
sox game-start.aiff game-start.wav
sox game-stop.aiff game-stop.wav
sox game-time-finished.aiff game-time-finished.wav
sox no-points.aiff no-points.wav
sox overtime.aiff overtime.wav
sox point-approved.aiff point-approved.wav
sox reverse-point.aiff reverse-point.wav
sox time-over.aiff time-over.wav
sox timeout.aiff timeout.wav
sox towel.aiff towel.wav
sox concede.aiff concede.wav

rm -f *.aiff
