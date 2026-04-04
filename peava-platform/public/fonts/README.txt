Place the following IBM Plex font files in this directory.
Download from: https://github.com/IBM/plex/releases

Required files:
  IBMPlexSans-Light.woff2
  IBMPlexSans-Regular.woff2
  IBMPlexSans-Medium.woff2
  IBMPlexSans-SemiBold.woff2
  IBMPlexMono-Regular.woff2
  IBMPlexMono-SemiBold.woff2

Steps on Mac (before uploading to VPS):
  1. Download the release zip from GitHub
  2. Extract and find the woff2 files inside fonts/IBM-Plex-Sans/fonts/complete/woff2/
     and fonts/IBM-Plex-Mono/fonts/complete/woff2/
  3. Copy the 6 files listed above into this folder
  4. Upload this entire fonts/ directory to /home/user/peava-platform/public/fonts/ on the VPS
