NPM DEPENDENCIES — Offline Installation Instructions
====================================================

Since the VPS has no internet access, install npm packages on your Mac
and upload the node_modules/ folder to the VPS.

Steps on Mac (must use same Node.js major version as VPS):

  mkdir peava-deps && cd peava-deps
  npm init -y
  npm install better-sqlite3 nodemailer
  cp -r node_modules /path/to/peava-platform/

  Then upload node_modules/ to /home/user/peava-platform/ on the VPS.

Check Node.js version:
  node --version   (run on both Mac and VPS — major version must match)

If versions differ, use nvm to switch Node.js on Mac:
  nvm use <vps-node-version>
  npm install better-sqlite3 nodemailer
