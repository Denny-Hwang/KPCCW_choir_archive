/**
 * 주간 자동 점검 — 영상 누락을 대원보다 먼저 안다.
 *
 * "유튜브에 있는데 앱에 없다"는 지금까지 대원이 먼저 발견했다. 매주 한 번 시간 트리거가
 *   1. 채널 업로드 중 새 영상만 받고 (업로드 전체 동기화, 따라잡으면 멈춘다)
 *   2. 보유 권의 새 수록곡을 등록하고 (악보집 일괄 등록)
 *   3. 파트 영상을 매칭하고 (영상 매칭 → _빠진파트)
 *   4. practice_links의 영상이 아직 살아 있는지 보고 (→ _깨진링크)
 *   5. 다음 찬양 곡의 준비 상태를 정리해
 * config의 `알림메일`로 보낸다. 결과는 `_주간점검` 시트에도 한 줄씩 남는다.
 *
 * 시간 트리거에서는 대화상자를 띄울 수 없다. 그래서 각 단계는 대화상자 없는 본체
 * (mirrorPlaylists_, registerOwnedBooks_, runMatching_)를 부른다.
 * 한 단계가 실패해도 다음 단계는 돈다 — 실패 사유는 보고서에 남는다.
 *
 * 메뉴: 주간 자동 점검 켜기 / 끄기 / 지금 실행.
 */

var WEEKLY_HANDLER = 'weeklyCheck';

/** 준비 상태를 따지는 파트. 반주는 영상이 없는 곡이 많아 뺀다. */
var READY_PARTS = ['합창', '소프라노', '알토', '테너', '베이스'];

function installWeeklyCheck() {
  var ui = SpreadsheetApp.getUi();
  removeWeeklyTriggers_();
  // 월요일 아침: 주일에 정한 곡이 시트에 들어간 뒤이고, 다음 연습(주일)까지 한 주가 남는다.
  ScriptApp.newTrigger(WEEKLY_HANDLER)
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.MONDAY)
    .atHour(6)
    .everyWeeks(1)
    .create();
  var to = readConfigValue_(getSpreadsheet_(), '알림메일');
  ui.alert(
    '주간 자동 점검',
    '켰습니다. 매주 월요일 아침 6시쯤 돕니다.\n\n' +
      (to
        ? '결과는 ' + to + '로 보냅니다.'
        : '⚠ config 시트에 `알림메일` 행이 없거나 비어 있어 메일은 보내지 않습니다.\n' +
          '   주소를 넣으면(여럿이면 쉼표로) 다음 실행부터 받습니다. 결과는 _주간점검 시트에도 남습니다.'),
    ui.ButtonSet.OK
  );
}

function removeWeeklyCheck() {
  var n = removeWeeklyTriggers_();
  SpreadsheetApp.getUi().alert(n ? '주간 자동 점검을 껐습니다.' : '켜져 있는 주간 자동 점검이 없습니다.');
}

function removeWeeklyTriggers_() {
  var n = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === WEEKLY_HANDLER) {
      ScriptApp.deleteTrigger(t);
      n++;
    }
  });
  return n;
}

/** 메뉴의 "지금 실행". 메일까지 보내고 결과를 그 자리에서도 보여준다. */
function runWeeklyCheckNow() {
  var report = weeklyCheck();
  SpreadsheetApp.getUi().alert(report.subject, report.body, SpreadsheetApp.getUi().ButtonSet.OK);
}

/** 시간 트리거가 부르는 함수. */
function weeklyCheck() {
  var ss = getSpreadsheet_();
  var report = weeklyCheck_(ss);
  logWeeklyCheck_(ss, report);
  var to = readConfigValue_(ss, '알림메일');
  if (to) {
    try {
      MailApp.sendEmail({ to: to, subject: report.subject, body: report.body });
    } catch (err) {
      logWeeklyCheck_(ss, { subject: '메일 발송 실패', body: String(err && err.message ? err.message : err), actionable: true });
    }
  }
  return report;
}

/** 단계를 차례로 돌려 보고서를 만든다. 돌려주는 것: { subject, body, actionable } */
function weeklyCheck_(ss) {
  var lines = [];
  var problems = 0;

  function step(label, fn) {
    try {
      return fn();
    } catch (err) {
      problems++;
      lines.push('✗ ' + label + ' 실패: ' + String(err && err.message ? err.message : err));
      return null;
    }
  }

  var synced = step('업로드 동기화', function () {
    var uploads = uploadsPlaylist_(resolveChannelIdQuiet_(ss));
    if (!uploads) throw new Error('채널 업로드 목록을 찾지 못했습니다. config의 유튜브채널ID를 넣어 주세요.');
    return mirrorPlaylists_(ss, [uploads], 'UPLOADS_RESUME_', { stopWhenCaughtUp: true });
  });
  if (synced) {
    lines.push('· 새 영상 ' + synced.added + '개 받음' + (synced.done ? '' : ' (다 못 받음 — 다음 실행에 이어서)'));
  }

  var registered = step('악보집 등록', function () { return registerOwnedBooks_(ss); });
  if (registered && !registered.error && registered.newSongs) {
    lines.push('· 새 수록곡 ' + registered.newSongs + '곡 등록 (' + registered.added.join(', ') + ')');
  }

  var matched = step('영상 매칭', function () { return runMatching_(ss); });
  if (matched && !matched.empty) {
    lines.push('· 파트 영상 ' + matched.added + '개 새로 붙음 (확인 대기)');
    if (matched.gapCount) lines.push('· 보유 권에서 파트가 빠진 곡 ' + matched.gapCount + '개 → _빠진파트 시트');
  }

  var dead = step('깨진 링크 점검', function () { return checkDeadLinks_(ss); });
  if (dead && dead.length) {
    problems += dead.length;
    lines.push('');
    lines.push('⚠ 재생되지 않는 파트 영상 ' + dead.length + '개 (삭제·비공개) → _깨진링크 시트');
    dead.slice(0, 10).forEach(function (d) { lines.push('   - ' + d[0] + ' / ' + d[1]); });
  }

  var ready = step('다음 찬양 점검', function () { return nextServiceReadiness_(ss); });
  if (ready) {
    lines.push('');
    lines.push(ready.title);
    ready.lines.forEach(function (l) { lines.push(l); });
    problems += ready.problems;
  }

  var appUrl = readConfigValue_(ss, '앱주소');
  if (appUrl) {
    lines.push('');
    lines.push('준비 상태 화면: ' + appUrl.replace(/\/?(#.*)?$/, '/') + '#/ready');
  }

  return {
    subject: (problems ? '[성가대] ⚠ 확인할 것 ' + problems + '개' : '[성가대] 이번 주 준비 이상 없음') +
      (ready && ready.date ? ' — ' + ready.date : ''),
    body: lines.join('\n'),
    actionable: problems > 0
  };
}

/**
 * 채널 ID를 대화상자 없이 찾는다. resolveChannelId_는 마지막에 사람에게 묻는데,
 * 트리거에서는 물을 사람이 없다. 캐시·config·핸들 조회까지만 하고 못 찾으면 빈 값.
 */
function resolveChannelIdQuiet_(ss) {
  var props = PropertiesService.getScriptProperties();
  var cached = props.getProperty('CHANNEL_ID');
  if (cached) return cached;
  var configured = extractChannelId_(readConfigValue_(ss, '유튜브채널ID'));
  if (configured) return configured;
  var handle = normalizeHandle_(readConfigValue_(ss, '유튜브채널핸들')) || DEFAULT_CHANNEL_HANDLE;
  try {
    var byHandle = YouTube.Channels.list('id', { forHandle: handle });
    if (byHandle.items && byHandle.items.length) return byHandle.items[0].id;
  } catch (e) {
    // 아래 페이지 읽기로 넘어간다.
  }
  return channelIdFromPage_(handle);
}

/**
 * practice_links의 영상이 아직 재생되는지 본다. videos.list는 50개당 1 unit.
 * 응답에 없는 ID(삭제됨)와 비공개 영상을 [표시명, 파트, URL, 상태]로 돌려주고 _깨진링크에 적는다.
 * 행은 지우지 않는다 — 사람이 보고 고친다.
 */
function checkDeadLinks_(ss) {
  var links = readSheet_(ss, 'practice_links', ss.getSpreadsheetTimeZone());
  var byId = {};
  links.forEach(function (row) {
    var id = youtubeVideoId_(row['URL']);
    if (!id) return;
    (byId[id] = byId[id] || []).push(row);
  });
  var ids = Object.keys(byId);
  var status = {};
  for (var i = 0; i < ids.length; i += 50) {
    var res = YouTube.Videos.list('status', { id: ids.slice(i, i + 50).join(','), maxResults: 50 });
    (res.items || []).forEach(function (v) { status[v.id] = (v.status && v.status.privacyStatus) || 'public'; });
  }

  var dead = [];
  ids.forEach(function (id) {
    var st = status[id];
    if (st === 'public' || st === 'unlisted') return;
    var reason = st ? '비공개' : '삭제됨';
    byId[id].forEach(function (row) {
      dead.push([String(row['표시명'] || ''), String(row['파트'] || ''), String(row['URL'] || ''), reason]);
    });
  });

  var sheet = ss.getSheetByName('_깨진링크') || ss.insertSheet('_깨진링크');
  sheet.clear();
  var headers = ['표시명', '파트', 'URL', '상태'];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
  if (dead.length) sheet.getRange(2, 1, dead.length, headers.length).setValues(dead);
  sheet.setFrozenRows(1);
  return dead;
}

/**
 * 다음 찬양일(오늘 이후 가장 가까운 것)의 준비 상태.
 * 앱의 준비 상태 화면(lib/readiness.ts)과 같은 기준이다: 곡마다 합창·S·A·T·B 영상이 있고
 * 확인됐는지, 연습 일정이 있는지.
 */
function nextServiceReadiness_(ss, todayKey) {
  var tz = ss.getSpreadsheetTimeZone() || 'America/Los_Angeles';
  var today = todayKey || Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  var services = readSheet_(ss, 'services', tz)
    .filter(function (s) { return String(s['찬양일'] || '') >= today; })
    .sort(function (a, b) { return String(a['찬양일']).localeCompare(String(b['찬양일'])); });

  if (!services.length) {
    return { date: '', title: '■ 다음 찬양', lines: ['⚠ 다음 찬양일이 시트에 없습니다. 선곡 화면에서 정해 주세요.'], problems: 1 };
  }
  var service = services[0];
  var date = String(service['찬양일']);
  var titles = ['곡1', '곡2', '곡3'].map(function (c) { return String(service[c] || '').trim(); }).filter(Boolean);

  var links = readSheet_(ss, 'practice_links', tz);
  var rehearsals = readSheet_(ss, 'rehearsals', tz).filter(function (r) { return String(r['찬양일']) === date; });

  var lines = [];
  var problems = 0;
  if (!titles.length) {
    lines.push('⚠ 곡이 아직 정해지지 않았습니다.');
    problems++;
  }
  titles.forEach(function (title) {
    var mine = links.filter(function (l) { return String(l['표시명']).trim() === title; });
    var missing = [];
    var unverified = [];
    READY_PARTS.forEach(function (part) {
      var forPart = mine.filter(function (l) { return String(l['파트']).trim() === part; });
      if (!forPart.length) missing.push(part);
      else if (!forPart.some(function (l) { return toBool_(l['검증']); })) unverified.push(part);
    });
    lines.push('· ' + title);
    if (missing.length) { lines.push('   ⚠ 영상 없음: ' + missing.join(', ')); problems++; }
    if (unverified.length) { lines.push('   ⚠ 확인 대기(공지에서 빠짐): ' + unverified.join(', ')); problems++; }
    if (!missing.length && !unverified.length) lines.push('   ✓ 다섯 파트 모두 확인됨');
  });
  var upcoming = rehearsals.filter(function (r) { return String(r['연습일']) >= today; });
  if (!rehearsals.length) {
    lines.push('⚠ 연습 일정이 없습니다.');
    problems++;
  } else {
    lines.push('· 연습 ' + rehearsals.length + '회 (남은 연습 ' + upcoming.length + '회)');
  }

  return { date: date, title: '■ 다음 찬양 ' + date + ' ' + String(service['예배구분'] || ''), lines: lines, problems: problems };
}

function logWeeklyCheck_(ss, report) {
  var sheet = ss.getSheetByName('_주간점검');
  if (!sheet) {
    sheet = ss.insertSheet('_주간점검');
    sheet.getRange(1, 1, 1, 3).setValues([['실행시각', '제목', '내용']]).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  var tz = ss.getSpreadsheetTimeZone() || 'America/Los_Angeles';
  sheet.appendRow([Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm'), report.subject, report.body]);
}
