#!/bin/bash
cd /home/kavia/workspace/code-generation/skycraft-pilot-91376-3ebee740/game_frontend_workspace/game_frontend
npm run build
EXIT_CODE=$?
if [ $EXIT_CODE -ne 0 ]; then
   exit 1
fi

