/* Git's zero-context hunk headers use 1-based lines. Deletions sit after the preceding line. */
function gitMarkers(hunks, count) {
  const markers = {};
  (hunks || '').split('\n').forEach(function (h) {
    const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(h);
    if (!m) return;
    const oldCount = m[2] == null ? 1 : Number(m[2]);
    const start = Number(m[3]), added = m[4] == null ? 1 : Number(m[4]);
    for (let i = start; i < start + added && i <= count; i++) {
      markers[i] = { kind: oldCount ? 'modified' : 'added' };
    }
    if (oldCount > added) {
      const line = Math.max(1, Math.min(count, start + Math.max(0, added - 1)));
      const marker = markers[line] || (markers[line] = {});
      marker.deleted = start === 0 ? 'before' : 'after';
    }
  });
  return markers;
}
if (typeof module !== 'undefined') module.exports = { gitMarkers };
