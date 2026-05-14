#!/bin/bash
export PATH="/usr/local/bin:/usr/bin:/bin:/home/arjunkv/.nvm/versions/node/$(ls /home/arjunkv/.nvm/versions/node 2>/dev/null | tail -1)/bin"
cd "/home/arjunkv/p/worktimer"
/home/arjunkv/.nvm/versions/node/v24.14.1/bin/npm start -- --no-sandbox
