# Part Ava Sprint Tracker — V4

## Start
```
node server.js
```
Access: http://yourserver:3003
Admin: username `saeed` / PIN `1234`

## What's new in V4
- Atomic JSON writes (crash-safe, no data loss)
- Task search (free-text across description, customer, notes, member)
- Task comments / activity log per task
- Bulk actions (multi-select → set status or priority)
- Duplicate task (one-click copy)
- Force-archive (admin — no 7-day wait)
- Manual sprint reset button (admin panel)
- Auto sprint reset every Saturday
- Excel export (current sprint, browser download)
- Persian / English UI toggle (FA/EN button in header)
- Task age indicator (days since last change — color coded)
- Compact/expanded Kanban view
- Summary bar (critical, high, in-progress counts — always visible)
- Light / dark mode

## Deployment
```bash
scp -r peava-sprint-v4/ user@yourserver:/opt/peava-sprint
cd /opt/peava-sprint
node server.js

# Keep alive after disconnect:
nohup node server.js > app.log 2>&1 &
```

## Requirements
- Node.js v14+
- No internet needed on server
- No npm install needed
