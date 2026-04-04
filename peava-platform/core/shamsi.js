'use strict';

// Gregorian → Shamsi (Persian) calendar conversion
// Ported from Partava-sprint/server.js — pure algorithm, no external deps
function toShamsi(date) {
  var g  = date || new Date();
  var gy = g.getFullYear(), gm = g.getMonth() + 1, gd = g.getDate();
  var gd_ = [31,28,31,30,31,30,31,31,30,31,30,31];
  var jd_ = [31,31,31,31,31,31,30,30,30,30,30,29];
  var i, g_d_no, j_d_no, jy, jm, jd, j_np;
  gy -= 1600; gm -= 1; gd -= 1;
  g_d_no = 365*gy + Math.floor((gy+3)/4) - Math.floor((gy+99)/100) + Math.floor((gy+399)/400);
  for (i = 0; i < gm; i++) g_d_no += gd_[i];
  if (gm > 1 && ((gy+1600)%4 === 0 && ((gy+1600)%100 !== 0 || (gy+1600)%400 === 0))) g_d_no++;
  g_d_no += gd;
  j_d_no = g_d_no - 79;
  j_np   = Math.floor(j_d_no / 12053); j_d_no %= 12053;
  jy     = 979 + 33*j_np + 4*Math.floor(j_d_no / 1461); j_d_no %= 1461;
  if (j_d_no >= 366) { jy += Math.floor((j_d_no-1)/365); j_d_no = (j_d_no-1) % 365; }
  for (i = 0; i < 11 && j_d_no >= jd_[i]; i++) j_d_no -= jd_[i];
  jm = i + 1; jd = j_d_no + 1;
  return jy + '/' + (jm < 10 ? '0'+jm : jm) + '/' + (jd < 10 ? '0'+jd : jd);
}

module.exports = { toShamsi };
