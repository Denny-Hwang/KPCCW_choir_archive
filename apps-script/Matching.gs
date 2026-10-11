/**
 * 영상 제목 해석 + 매칭 + 점검 보고서.
 *
 * yt_cache(YouTubeSync.gs가 채운다)에 쌓인 영상을 songs의 곡·파트에 맞춰 practice_links에 붙인다.
 * 할당량을 쓰지 않으므로 규칙을 고친 뒤 몇 번이든 다시 돌려도 된다.
 *
 * 메뉴: 영상 매칭(matchVideos), 곡명 정리(repairSongTitles).
 * 보고서 시트: _매칭실패, _빠진파트.
 */

function matchVideos() {
  var ui = SpreadsheetApp.getUi();
  var r = runMatching_(getSpreadsheet_());
  if (r.empty) {
    ui.alert('yt_cache가 비어 있습니다. 먼저 "채널 동기화"를 실행하세요.');
    return;
  }
  ui.alert(
    '영상 매칭 완료',
    '추가 ' + r.added + '개 (전부 검증 대기)\n' +
      (r.midiOnly ? '그중 ' + r.midiOnly + '개는 실연이 없어 MIDI를 썼습니다.\n' : '') +
      (r.notOwnedTotal
        ? '보유하지 않은 권이라 건너뜀 ' + r.notOwnedTotal + '개 (' + r.notOwnedCodes.join(', ') + ')\n'
        : '') +
      '매칭 실패 ' + r.failures + '건\n' +
      (r.rejected ? '시트가 거부한 행 ' + r.rejected + '개 — ' + r.firstRejectReason + '\n' : '') +
      '\n' +
      (r.rejected + r.failures ? '_매칭실패 시트에 목록을 적었습니다.\n' : '') +
      (r.partless.length
        ? '\n⚠ 파트(소프라노~베이스) 영상이 없는 권: ' + r.partless.join(', ') + '\n' +
          'yt_cache에 이 권들의 파트 영상 자체가 없습니다. [업로드 전체 동기화]를 먼저 실행해 보고,\n' +
          '그래도 남으면 유튜브에서 "[중앙아트] 중앙성가 NN집" 재생목록을 찾아 [재생목록 직접 추가]에 넣으세요.\n\n'
        : '') +
      (r.gapCount
        ? '아직 파트 영상이 빠진 곡 ' + r.gapCount + '개 — [_빠진파트] 시트에 유튜브 검색 주소와 함께 적었습니다.\n' +
          '(부른 곡·예정곡이 위에 옵니다.)\n\n'
        : '보유 권의 모든 곡에 합창·소프라노·알토·테너·베이스 영상이 있습니다.\n\n') +
      '추가된 링크는 사람이 재생을 확인해 검증 열을 체크하기 전까지 공지에 나가지 않습니다.',
    ui.ButtonSet.OK
  );
}

/**
 * 영상 매칭의 본체. 대화상자를 띄우지 않으므로 시간 트리거(주간 자동 점검)에서도 돈다.
 * 돌려주는 것: { empty, added, midiOnly, notOwnedTotal, notOwnedCodes, failures, rejected,
 *               firstRejectReason, partless, gapCount }
 */
function runMatching_(ss) {
  var tz = ss.getSpreadsheetTimeZone();

  // 드롭다운의 원본 범위는 만들어질 때의 행 수로 굳는다(songs!B2:B1000 같은 식).
  // 그 뒤 [악보집 일괄 등록]으로 곡이 늘어나면 새 곡은 목록 밖에 남고,
  // 그 표시명을 practice_links에 쓰려는 순간 전부 거부된다.
  // 다시 심는 것은 값이 아니라 규칙뿐이라 데이터는 그대로다.
  installValidations_(ss);

  var cache = readCacheRows_(ss);
  if (!cache.length) return { empty: true };

  var songs = readSheet_(ss, 'songs', tz);
  var byCode = {};
  var byBookAndTitle = {};
  var booksWithSongs = {};
  var bookOfDisplay = {};
  for (var s = 0; s < songs.length; s++) {
    var song = songs[s];
    var code = String(song['곡코드'] || '').trim();
    var display = String(song['표시명'] || '').trim();
    if (!display) continue;
    if (code) byCode[code] = display;
    var bookCode = String(song['집코드'] || '').trim();
    if (bookCode) {
      byBookAndTitle[bookCode + '|' + normalizeTitle_(song['제목'])] = display;
      booksWithSongs[bookCode] = true;
      bookOfDisplay[display] = bookCode;
    }
  }

  // 권별로 어떤 파트가 채워지는지 센다. "왜 이 권은 파트가 없지?"는
  // 매칭이 끝난 자리에서 바로 답해야지, 캐시를 뒤져서 알아낼 일이 아니다.
  var partsByBook = {};
  function notePart_(display, part) {
    var book = bookOfDisplay[display];
    if (!book) return;
    if (!partsByBook[book]) partsByBook[book] = {};
    partsByBook[book][part] = true;
  }

  var links = readSheet_(ss, 'practice_links', tz);
  var seen = {};
  for (var l = 0; l < links.length; l++) {
    seen[String(links[l]['표시명']) + '|' + String(links[l]['파트'])] = true;
    notePart_(String(links[l]['표시명']), String(links[l]['파트']));
  }

  // 후보를 먼저 모은 뒤, 같은 (곡, 파트)에서 실연을 MIDI보다 우선한다.
  // 41집 이후는 같은 곡이 두 벌로 올라오는데, 연습에는 실연 녹음이 낫다.
  var candidates = {};
  var failures = [];
  var notOwned = {};
  var midiOnly = 0;

  for (var c = 0; c < cache.length; c++) {
    var entry = cache[c];
    var parsed = parseVideoTitle_(entry['제목']);
    // 재생목록명이 1순위, 제목 안의 집 이름이 2순위.
    var bookCode = parsePlaylistBook_(entry['재생목록명']) || parsed.bookCode;

    if (!bookCode) continue; // 중앙성가 집이 아닌 영상. 실패로 세지 않는다.

    // songs에 한 곡도 없는 권은 우리가 안 가진 권이다. 채널에는 40여 권이 올라와 있어서
    // 이걸 실패로 세면 실패 수천 건에 진짜 실패가 묻힌다.
    if (!booksWithSongs[bookCode]) {
      notOwned[bookCode] = (notOwned[bookCode] || 0) + 1;
      continue;
    }

    var display = null;
    if (parsed.number) display = byCode[bookCode + '-' + padNumber_(parsed.number)] || null;
    if (!display && parsed.title) display = byBookAndTitle[bookCode + '|' + normalizeTitle_(parsed.title)] || null;

    if (!display) {
      failures.push(entry['재생목록명'] + ' / ' + entry['제목']);
      continue;
    }

    var key = display + '|' + parsed.part;
    if (seen[key]) continue; // 이미 시트에 있는 조합은 건드리지 않는다 (§9.3 append only).

    notePart_(display, parsed.part);

    var prev = candidates[key];
    if (!prev || (prev.isMidi && !parsed.isMidi)) {
      candidates[key] = { display: display, part: parsed.part, videoId: entry['videoId'], isMidi: parsed.isMidi };
    }
  }

  var linkSheet = ss.getSheetByName('practice_links');
  var linkHeaders = linkSheet.getRange(1, 1, 1, linkSheet.getLastColumn()).getValues()[0];

  var toAppend = [];
  for (var k in candidates) {
    var v = candidates[k];
    if (v.isMidi) midiOnly++;
    toAppend.push(buildLinkRow_(linkHeaders, v));
  }

  // 드롭다운에 걸리는 값이 하나라도 있으면 setValues가 묶음 전체를 예외로 죽인다.
  // 먼저 걸러 내야 나머지가 들어가고, 무엇이 걸렸는지도 알 수 있다.
  var split = splitByValidation_(linkSheet, linkHeaders, toAppend);
  if (split.ok.length) {
    linkSheet
      .getRange(linkSheet.getLastRow() + 1, 1, split.ok.length, linkHeaders.length)
      .setValues(split.ok);
  }

  var report = split.bad.map(function (b) { return '시트가 거부함 / ' + b.reason; });
  writeReport_(ss, report.concat(failures));

  var nameIdx = linkHeaders.map(function (h) { return String(h).trim(); }).indexOf('표시명');
  var partIdx = linkHeaders.map(function (h) { return String(h).trim(); }).indexOf('파트');
  var have = {};
  for (var sk in seen) have[sk] = true;
  split.ok.forEach(function (row) { have[row[nameIdx] + '|' + row[partIdx]] = true; });
  var gapCount = writeGapReport_(ss, songs, booksWithSongs, have, tz);

  var notOwnedCodes = Object.keys(notOwned).sort(function (a, b) {
    return bookNumber_(a) - bookNumber_(b);
  });
  var notOwnedTotal = 0;
  notOwnedCodes.forEach(function (c) { notOwnedTotal += notOwned[c]; });

  // 합창·반주뿐이고 소프라노~베이스가 하나도 없는 권. [합창 듣기] 목록만 캐시에
  // 들어온 권이 정확히 이렇게 보인다 — 실제로 중39~41이 그랬다.
  var VOICE_PARTS = ['소프라노', '알토', '테너', '베이스'];
  var partless = [];
  for (var pb in booksWithSongs) {
    var bookParts = partsByBook[pb] || {};
    if (!VOICE_PARTS.some(function (part) { return bookParts[part]; })) partless.push(pb);
  }
  partless.sort(function (a, b) { return bookNumber_(a) - bookNumber_(b); });

  return {
    empty: false,
    added: split.ok.length,
    midiOnly: midiOnly,
    notOwnedTotal: notOwnedTotal,
    notOwnedCodes: notOwnedCodes,
    failures: failures.length,
    rejected: split.bad.length,
    firstRejectReason: split.bad.length ? split.bad[0].reason : '',
    partless: partless,
    gapCount: gapCount
  };
}

/** 빠진 파트를 따지는 대상. 반주는 영상이 없는 권이 많아 빼고 본다. */
var GAP_PARTS = ['합창', '소프라노', '알토', '테너', '베이스'];

/**
 * 보유 권의 곡마다 아직 링크가 없는 파트를 [_빠진파트] 시트에 적는다.
 *
 * "영상이 실제로는 있는데 앱에서 안 보인다"는 곡 하나를 열어 봐야 드러났다.
 * 서가 전체를 한 장에 모아, 부른 곡·예정곡부터 유튜브 검색 주소와 함께 보여준다.
 * 사람이 찾으면 practice_links에 그 주소를 넣거나, 그 영상이 속한 재생목록을
 * [재생목록 직접 추가]에 넣으면 된다.
 *
 * have: '표시명|파트' → true. 돌려주는 것: 빠진 곡 수.
 */
function writeGapReport_(ss, songs, booksWithSongs, have, tz) {
  var used = {};
  readSheet_(ss, 'services', tz).forEach(function (row) {
    ['곡1', '곡2', '곡3'].forEach(function (c) {
      var v = String(row[c] || '').trim();
      if (v) used[v] = true;
    });
  });

  var rows = [];
  for (var i = 0; i < songs.length; i++) {
    var display = String(songs[i]['표시명'] || '').trim();
    var book = String(songs[i]['집코드'] || '').trim();
    if (!display || !book || !booksWithSongs[book]) continue;
    var missing = GAP_PARTS.filter(function (part) { return !have[display + '|' + part]; });
    if (!missing.length) continue;
    var title = String(songs[i]['제목'] || '').trim();
    var no = songs[i]['수록번호'];
    var query = '중앙성가 ' + bookNumber_(book) + '집 ' + (no ? padNumber_(Number(no)) + '. ' : '') + title;
    rows.push([
      used[display] ? '부름·예정' : '',
      book,
      String(songs[i]['곡코드'] || ''),
      title,
      missing.length === GAP_PARTS.length ? '전부' : missing.join(', '),
      'https://www.youtube.com/results?search_query=' + encodeURIComponent(query)
    ]);
  }
  rows.sort(function (a, b) {
    return (a[0] ? 0 : 1) - (b[0] ? 0 : 1) ||
      bookNumber_(a[1]) - bookNumber_(b[1]) ||
      String(a[2]).localeCompare(String(b[2]));
  });

  var headers = ['부름', '집코드', '곡코드', '제목', '빠진 파트', '유튜브 검색'];
  var sheet = ss.getSheetByName('_빠진파트') || ss.insertSheet('_빠진파트');
  sheet.clear();
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
  if (rows.length) sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  sheet.setFrozenRows(1);
  return rows.length;
}

/**
 * 곡명 정리 — 메뉴: 성가 아카이브 > 곡명 정리 (파트 꼬리 떼기)
 *
 * 옛 파서가 "이런 교회 되게 하소서 합창"처럼 파트 이름을 곡명에 붙인 채 등록한 곡을 고친다.
 * 표시명은 제목에서 수식으로 만들어지므로, 제목을 바꾸면 표시명이 바뀌고
 * 그 표시명을 쓰던 practice_links·services 칸이 끊긴다. 그래서 세 시트를 함께 바꾼다.
 *
 * 채널에서 자동 등록한 곡(출처 youtube_channel)만 손댄다 — 사람이 쓴 곡명은 그대로 둔다.
 * 바꾸기 전에 목록을 보여주고 묻는다. 되돌리기는 시트 버전 기록으로 한다.
 */
function repairSongTitles() {
  var ui = SpreadsheetApp.getUi();
  var ss = getSpreadsheet_();
  var songsSheet = ss.getSheetByName('songs');
  if (!songsSheet || songsSheet.getLastRow() < 2) {
    ui.alert('songs 시트가 비어 있습니다.');
    return;
  }

  var values = songsSheet.getRange(1, 1, songsSheet.getLastRow(), songsSheet.getLastColumn()).getValues();
  var headers = values[0].map(function (h) { return String(h).trim(); });
  var titleCol = headers.indexOf('제목');
  var displayCol = headers.indexOf('표시명');
  var codeCol = headers.indexOf('곡코드');
  var sourceCol = headers.indexOf('출처');
  if (titleCol === -1 || displayCol === -1 || codeCol === -1) {
    ui.alert('songs 시트에 제목/표시명/곡코드 열이 없습니다.');
    return;
  }

  var fixes = [];
  for (var r = 1; r < values.length; r++) {
    if (sourceCol !== -1 && String(values[r][sourceCol]).trim() !== 'youtube_channel') continue;
    var title = String(values[r][titleCol] || '').trim();
    var stripped = stripPartTail_(title);
    if (!stripped) continue;
    var code = String(values[r][codeCol] || '').trim();
    fixes.push({
      row: r + 1,
      from: title,
      to: stripped,
      oldDisplay: String(values[r][displayCol] || '').trim(),
      newDisplay: code ? stripped + ' (' + code + ')' : stripped
    });
  }

  if (!fixes.length) {
    ui.alert('곡명 정리', '파트 이름이 곡명 끝에 붙은 곡이 없습니다.', ui.ButtonSet.OK);
    return;
  }

  var preview = fixes.slice(0, 15).map(function (f) { return '  ' + f.from + '  →  ' + f.to; }).join('\n');
  var answer = ui.alert(
    '곡명 정리',
    fixes.length + '곡의 이름 끝에서 파트 이름을 뗍니다.\n\n' + preview +
      (fixes.length > 15 ? '\n  … 외 ' + (fixes.length - 15) + '곡' : '') +
      '\n\npractice_links·services의 같은 표시명도 함께 바꿉니다. 진행할까요?',
    ui.ButtonSet.YES_NO
  );
  if (answer !== ui.Button.YES) return;

  fixes.forEach(function (f) { songsSheet.getRange(f.row, titleCol + 1).setValue(f.to); });
  // 표시명 수식이 다시 계산되고, 드롭다운 원본 범위가 새 이름을 담아야 아래 쓰기가 통과한다.
  SpreadsheetApp.flush();
  installValidations_(ss);

  var rename = {};
  fixes.forEach(function (f) { if (f.oldDisplay) rename[f.oldDisplay] = f.newDisplay; });
  var changed = renameCells_(ss, 'practice_links', ['표시명'], rename) +
    renameCells_(ss, 'services', ['곡1', '곡2', '곡3'], rename);

  ui.alert(
    '곡명 정리 완료',
    fixes.length + '곡 이름을 고치고, 그 곡을 가리키던 칸 ' + changed + '개를 새 이름으로 바꿨습니다.\n\n' +
      '이어서 [영상 매칭]을 실행하면 빠졌던 파트 영상이 채워집니다.',
    ui.ButtonSet.OK
  );
}

/** 지정한 열에서 rename의 키와 같은 값을 새 값으로 바꾼다. 바꾼 칸 수를 돌려준다. */
function renameCells_(ss, sheetName, columnNames, rename) {
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet || sheet.getLastRow() < 2) return 0;
  var count = 0;
  columnNames.forEach(function (name) {
    var col = columnIndex_(sheet, name);
    if (!col) return;
    var range = sheet.getRange(2, col, sheet.getLastRow() - 1, 1);
    var vals = range.getValues();
    var touched = false;
    for (var i = 0; i < vals.length; i++) {
      var v = String(vals[i][0] || '').trim();
      if (rename[v]) { vals[i][0] = rename[v]; touched = true; count++; }
    }
    if (touched) range.setValues(vals);
  });
  return count;
}

/**
 * 드롭다운(데이터 확인)이 걸린 열의 허용값. 걸려 있지 않으면 null.
 *
 * 열 이름으로 찾고, 판정 기준이 범위든 목록이든 같은 모양으로 돌려준다.
 */
function allowedValues_(sheet, headerName) {
  var col = columnIndex_(sheet, headerName);
  if (!col) return null;

  var rule = sheet.getRange(2, col).getDataValidation();
  if (!rule) return null;

  var type = rule.getCriteriaType();
  var args = rule.getCriteriaValues();
  var list;
  var source;
  if (type === SpreadsheetApp.DataValidationCriteria.VALUE_IN_RANGE) {
    list = args[0].getValues().map(function (r) { return r[0]; });
    // 어느 범위를 보고 있는지 남긴다. 범위가 굳어 새 곡을 못 담는 일이 실제로 있었다.
    source = args[0].getSheet().getName() + '!' + args[0].getA1Notation();
  } else if (type === SpreadsheetApp.DataValidationCriteria.VALUE_IN_LIST) {
    list = args[0];
    source = '목록 [' + args[0].join(', ') + ']';
  } else {
    return null; // 우리가 쓰는 두 종류가 아니면 검사하지 않는다.
  }

  var set = {};
  var count = 0;
  for (var i = 0; i < list.length; i++) {
    var v = String(list[i] === null || list[i] === undefined ? '' : list[i]).trim();
    if (v && !set[v]) { set[v] = true; count++; }
  }
  return { set: set, source: source, count: count };
}

/**
 * 붙이기 전에 드롭다운 제약을 먼저 확인한다.
 *
 * 드롭다운이 걸린 열에 허용되지 않은 값을 setValues로 쓰면, 한 칸 때문에
 * **묶음 전체**가 예외로 죽는다. 그런데 시트가 던지는 것은 그 열의 도움말 문구
 * 하나뿐이라("songs 시트의 표시명 중에서 고르세요..."), 어느 열의 어느 값이
 * 걸렸는지 알 수가 없다. 그래서 쓰기 전에 걸러 내고, 걸린 값을 이름과 함께 돌려준다.
 *
 * 빈 칸은 시트도 허용하므로 검사하지 않는다.
 */
function splitByValidation_(sheet, headers, rows) {
  var checks = [];
  for (var h = 0; h < headers.length; h++) {
    var name = String(headers[h]).trim();
    if (!name) continue;
    var allowed = allowedValues_(sheet, name);
    if (allowed) checks.push({ name: name, index: h, rule: allowed });
  }
  if (!checks.length) return { ok: rows, bad: [] };

  var ok = [];
  var bad = [];
  for (var r = 0; r < rows.length; r++) {
    var reason = null;
    for (var c = 0; c < checks.length; c++) {
      var value = rows[r][checks[c].index];
      if (value === '' || value === null || value === undefined) continue;
      if (!checks[c].rule.set[String(value).trim()]) {
        reason = checks[c].name + ' = "' + value + '" — 허용값 ' + checks[c].rule.count +
          '개 중에 없음 (원본: ' + checks[c].rule.source + ')';
        break;
      }
    }
    if (reason) bad.push({ row: rows[r], reason: reason });
    else ok.push(rows[r]);
  }
  return { ok: ok, bad: bad };
}

/** practice_links 행을 열 이름으로 만든다. 열 순서에 기대지 않는다 (§4.5). */
function buildLinkRow_(headers, candidate) {
  return headers.map(function (header) {
    switch (String(header).trim()) {
      case '표시명': return candidate.display;
      case '파트': return candidate.part;
      case 'URL': return 'https://youtu.be/' + candidate.videoId;
      case '출처': return 'youtube_channel';
      case '검증': return false;
      default: return '';
    }
  });
}

/**
 * 재생목록명 → 집코드.
 *
 * 실제 이름은 "[중앙아트] 중앙성가 52집", "[합창 듣기] 중앙성가 40집"처럼 앞머리 태그가 다양하다.
 * 태그는 걷어내되, 같은 채널에 이름 안에 "중앙성가 N집"을 품은 **다른 시리즈**가 함께 있다.
 *
 *   남성찬양대를 위한 중앙성가 2집 / 여성찬양대를 위한 중앙성가 2집 / 어린이 중앙성가 2집
 *
 * 이 셋을 전부 중2로 읽으면 서로 다른 세 권의 곡이 한 권에 섞인다(실제로 중3은 네 갈래였다).
 * 그래서 대괄호 태그를 걷어낸 뒤 "중앙성가" 앞에 글자가 남으면 다른 시리즈로 본다.
 * 뒤에 붙는 말("(구)", "- " 같은 것)은 같은 권의 다른 판이므로 그대로 받는다.
 */
function parsePlaylistBook_(playlistName) {
  var name = String(playlistName || '').replace(/\[[^\]]*\]/g, ' ');
  var m = name.match(/중앙성가\s*(\d+)\s*집/);
  if (!m) return null;
  if (bookQualifier_(name.slice(0, m.index))) return null;
  return '중' + parseInt(m[1], 10);
}

/**
 * "중앙성가" 앞에 남은 수식어. 공백·따옴표·구분자만 남으면 수식어가 없는 것이다.
 * 값이 있으면 본 시리즈가 아니라는 뜻이다.
 */
function bookQualifier_(head) {
  return String(head || '')
    .replace(/[\s'"\u2018\u2019\u201C\u201D()\[\]|\uFF5C\u00B7\u30FB\-\u2013\u2014_:,]/g, '')
    .trim();
}

var PART_PATTERNS = [
  [/소프라노|sop(rano)?/i, '소프라노'],
  [/알토|alto/i, '알토'],
  [/테너|tenor/i, '테너'],
  [/베이스|바리톤|bass|baritone/i, '베이스'],
  [/반주|피아노|accomp|\bMR\b/i, '반주'],
  [/합창|전곡|전체|full|tutti/i, '합창']
];

function matchPart_(text) {
  for (var i = 0; i < PART_PATTERNS.length; i++) {
    if (PART_PATTERNS[i][0].test(text)) return PART_PATTERNS[i][1];
  }
  return null;
}

/**
 * 영상 제목에서 곡번호·곡명·파트를 뽑는다. 실제 채널의 형식은 이렇다.
 *
 *   [중앙아트] 중앙성가 52집｜31. 하나님은 영이시니 (입례송) – 소프라노
 *   [중앙아트] 중앙성가 40집 32. 기도송 - 합창
 *   [중앙아트] ‘하나님의 시선 9집’ 13. 어버이의 사랑 – 소프라노 MIDI
 *
 * 집 이름과 곡번호 사이 구분자가 전각 ｜이기도 하고 공백이기도 하며,
 * 집 이름이 따옴표에 싸이기도 한다. 곡명에는 괄호와 &가 들어간다.
 * 41집 이후는 같은 곡이 MIDI와 실연 두 벌로 올라오므로 구분해 둔다.
 */
function parseVideoTitle_(rawTitle) {
  var cleaned = String(rawTitle || '').replace(/\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim();

  var isMidi = /\bMIDI\b/i.test(cleaned);
  cleaned = cleaned.replace(/\bMIDI\b/gi, '').replace(/\s+/g, ' ').trim();

  // 집 번호는 뒤에 '집'이 붙으므로, 점이 따라오는 첫 숫자가 곡번호다.
  var numMatch = cleaned.match(/(\d{1,3})\s*\.\s*(.+)$/);
  var number = numMatch ? parseInt(numMatch[1], 10) : null;
  var rest = numMatch ? numMatch[2].trim() : cleaned;

  // 파트는 맨 뒤 구분자 뒤에 온다. 뒤쪽이 실제 파트 이름일 때만 잘라낸다.
  // (곡명 자체에 하이픈이 들어가도 잘리지 않게 하기 위해서다.)
  var part = null;
  var title = rest;
  // 파트를 어디서 읽었는지. 곡명을 고를 때 구분자가 있던 제목을 더 믿는다 (songsFromCache_).
  var partFrom = 'none';
  var sep = rest.match(/^(.*?)\s*[–—\-|｜]\s*([^–—\-|｜]{1,24})\s*$/);
  if (sep) {
    var mapped = matchPart_(sep[2]);
    if (mapped) {
      part = mapped;
      title = sep[1].trim();
      partFrom = 'separator';
    }
  }

  // 구분자 없이 파트가 곡명 뒤에 바로 붙는 옛 형식 (36집 등).
  //   [중앙아트] 중앙성가 36집 09. 이런 교회 되게 하소서 합창
  //   [중앙아트] 중앙성가 36집 09. 이런 교회 되게 하소서 (알토)
  // 전에는 파트는 맞게 읽고 곡명에서는 떼지 않아, 악보집 등록이 곡 이름을
  // "이런 교회 되게 하소서 합창"으로 만들었다. 끝의 낱말이 파트 이름 그 자체일 때만 뗀다.
  if (!part) {
    var tail = rest.match(/^(.*\S)\s+[(\[]?\s*(합창|소프라노|알토|테너|베이스|바리톤|반주|피아노)\s*\d?\s*[)\]]?\s*$/);
    if (tail) {
      part = matchPart_(tail[2]);
      title = tail[1].trim();
      partFrom = 'tail';
    }
  }
  if (!part) part = matchPart_(rest) || '합창';

  // 제목 안에도 집 이름이 들어 있다. 재생목록명이 애매할 때 쓴다.
  var head = numMatch ? cleaned.slice(0, numMatch.index) : '';

  return {
    number: number,
    title: title.replace(/^[\u2018\u2019\u201C\u201D'"]+|[\u2018\u2019\u201C\u201D'"]+$/g, '').trim(),
    part: part,
    partFrom: partFrom,
    isMidi: isMidi,
    bookCode: parsePlaylistBook_(head)
  };
}

/** 끝에 파트 이름이 붙어 버린 곡명에서 그 꼬리를 뗀다. 꼬리가 없으면 ''. */
function stripPartTail_(title) {
  var m = String(title || '').match(/^(.*\S)\s+[(\[]?\s*(합창|소프라노|알토|테너|베이스|반주)\s*\d?\s*[)\]]?\s*$/);
  return m ? m[1].trim() : '';
}

/** 제목 정규화 (§9.4). 매칭 전 양쪽에 동일하게 적용한다. */
function normalizeTitle_(value) {
  return String(value || '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\([^)]*\)/g, '')
    // 전각 영숫자를 반각으로.
    .replace(/[！-～]/g, function (ch) { return String.fromCharCode(ch.charCodeAt(0) - 0xfee0); })
    .replace(/[\s·・\-—–_'"'''""!?,.]/g, '')
    .replace(/^0+/, '')
    .toLowerCase();
}

function padNumber_(n) {
  return n < 10 ? '0' + n : String(n);
}

function writeReport_(ss, failures) {
  var sheet = ss.getSheetByName('_매칭실패') || ss.insertSheet('_매칭실패');
  sheet.clear();
  sheet.getRange(1, 1, 1, 1).setValues([['매칭하지 못한 영상 (재생목록명 / 제목)']]).setFontWeight('bold');
  if (failures.length) {
    sheet.getRange(2, 1, failures.length, 1).setValues(failures.map(function (f) { return [f]; }));
  }
}
