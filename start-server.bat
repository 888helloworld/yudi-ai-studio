@echo off
cd /d E:\项目\xiaohongshu-image-tool
rem Node 24 默认不读系统代理，打开后 fetch 才会走 Clash，否则上游大图回传会被限速到约 11KB/s。
set NODE_USE_ENV_PROXY=1
node server.js
