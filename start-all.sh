#!/usr/bin/env bash
# Lance shell (host) + promote + diaspora en parallèle (Native Federation).
# Ordre : remotes d'abord (ils exposent remoteEntry.json), puis le host.
set -m
cd "$(dirname "$0")"
NG="node node_modules/.bin/ng"

echo "▶ remote promote  (http://localhost:4201)"
$NG serve promote  > /tmp/union-promote.log  2>&1 &
echo "▶ remote diaspora (http://localhost:4202)"
$NG serve diaspora > /tmp/union-diaspora.log 2>&1 &

# petit délai pour laisser les remotes démarrer
sleep 8

echo "▶ host shell      (http://localhost:4200)"
$NG serve shell > /tmp/union-shell.log 2>&1 &

echo ""
echo "Apps :"
echo "  • Host shell   : http://localhost:4200"
echo "  • Promote      : http://localhost:4201  (standalone)"
echo "  • Diaspora     : http://localhost:4202  (standalone)"
echo "Logs : /tmp/union-{shell,promote,diaspora}.log"
echo "Ctrl+C pour tout arrêter."
wait
