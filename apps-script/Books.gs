/**
 * 악보집(books)과 수록곡(songs) 등록.
 *
 * yt_cache에 있는 영상 제목에서 권별 수록곡 목록을 뽑아 songs에 붙인다.
 * 채널에 없는 권은 목차를 붙여넣어 등록한다.
 *
 * 메뉴: 악보집 일괄 등록(registerOwnedBooks), 악보집 등록 (한 권)(registerBookPrompt).
 */

/**
 * 보유 악보집 일괄 등록 — 메뉴: 성가 아카이브 > 악보집 일괄 등록
 *
 * 권마다 따로 누르면 그때마다 캐시 1만여 행을 다시 읽고, 채널에 없는 권에서는
 * 목차 붙여넣기 대화상자가 떠서 흐름이 끊긴다. 캐시를 한 번만 읽고
 * books의 보유 권을 전부 처리한 뒤, 채널에 없던 권을 모아서 알려준다.
 */
function registerOwnedBooks() {
  var ui = SpreadsheetApp.getUi();
  var r = registerOwnedBooks_(getSpreadsheet_());
  if (r.error) {
    ui.alert(r.error);
    return;
  }
  ui.alert(
    '악보집 일괄 등록 완료',
    (r.added.length ? '추가됨\n  ' + r.added.join('\n  ') + '\n\n' : '새로 추가된 곡이 없습니다.\n\n') +
      (r.missing.length
        ? '채널에 재생목록이 없는 권: ' + r.missing.join(', ') + '\n' +
          '이 권들은 [악보집 등록]으로 목차를 붙여넣거나, 선곡할 때마다 한 곡씩 넣으면 됩니다.\n\n'
        : '') +
      (r.rejected.length
        ? '시트가 거부한 행 ' + r.rejected.length + '개:\n  ' + r.rejected.slice(0, 5).join('\n  ') + '\n' +
          '드롭다운 원본을 다시 심고도 걸린 값입니다. 위 원본 범위를 시트에서 직접 확인하세요.\n\n'
        : '') +
      '전부 상태=후보, 검증=FALSE로 들어갔습니다.\n' +
      '이어서 [영상 매칭]을 실행하면 파트 영상이 채워집니다.',
    ui.ButtonSet.OK
  );
}

/**
 * 악보집 일괄 등록의 본체. 대화상자 없이 돈다(주간 자동 점검이 부른다).
 * 돌려주는 것: { error } 또는 { added: [문장], newSongs: 수, missing: [집코드], rejected: [문장] }
 */
function registerOwnedBooks_(ss) {
  var books = readSheet_(ss, 'books', ss.getSpreadsheetTimeZone());

  var owned = [];
  for (var b = 0; b < books.length; b++) {
    var code = String(books[b]['집코드'] || '').trim();
    if (code && toBool_(books[b]['보유'])) owned.push(code);
  }
  if (!owned.length) return { error: 'books 시트에 보유(TRUE)로 표시된 악보집이 없습니다.' };

  var cache = readCacheRows_(ss);
  if (!cache.length) return { error: 'yt_cache가 비어 있습니다. 먼저 [채널 동기화]를 실행하세요.' };

  // songs.집코드 드롭다운의 원본은 books다. books에 권이 늘었으면 범위를 다시 심어야 한다.
  installValidations_(ss);

  var added = [];
  var missing = [];
  var rejected = [];
  var newSongs = 0;
  for (var i = 0; i < owned.length; i++) {
    var entries = songsFromCache_(cache, owned[i]);
    if (!entries.length) {
      missing.push(owned[i]);
      continue;
    }
    var n = appendSongs_(ss, owned[i], entries, rejected);
    newSongs += n;
    if (n) added.push(owned[i] + ' ' + n + '곡' + (n < entries.length ? ' (이미 있던 ' + (entries.length - n) + '곡 제외)' : ''));
  }
  return { added: added, newSongs: newSongs, missing: missing, rejected: rejected };
}

/**
 * 신규 악보집 등록 (§9.4).
 * 채널 재생목록에서 수록곡을 찾고, 없으면 목차 붙여넣기로 폴백한다.
 */
function registerBookPrompt() {
  var ui = SpreadsheetApp.getUi();
  var response = ui.prompt('악보집 등록', '중앙성가 권 번호를 입력하세요 (예: 50)', ui.ButtonSet.OK_CANCEL);
  if (response.getSelectedButton() !== ui.Button.OK) return;

  var volume = parseInt(response.getResponseText(), 10);
  if (!volume || volume < 1) {
    ui.alert('권 번호를 숫자로 입력해 주세요.');
    return;
  }

  var ss = getSpreadsheet_();
  var bookCode = '중' + volume;
  ensureBookRow_(ss, bookCode, volume);

  var entries = songsFromCache_(readCacheRows_(ss), bookCode);
  if (!entries.length) {
    var pasted = ui.prompt(
      '수록곡 목록',
      bookCode + '의 재생목록을 캐시에서 찾지 못했습니다.\n' +
        '목차를 붙여넣으세요. 한 줄에 "번호<탭>곡명" 또는 "번호. 곡명" 형식 모두 됩니다.',
      ui.ButtonSet.OK_CANCEL
    );
    if (pasted.getSelectedButton() !== ui.Button.OK) return;
    entries = parsePastedToc_(pasted.getResponseText());
  }

  var rejected = [];
  var added = appendSongs_(ss, bookCode, entries, rejected);
  ui.alert(
    '악보집 등록 완료',
    bookCode + ' · ' + added + '곡 추가 (전부 상태=후보, 검증=FALSE)\n\n' +
      (rejected.length
        ? '시트가 거부한 행 ' + rejected.length + '개:\n  ' + rejected.slice(0, 5).join('\n  ') + '\n' +
          '드롭다운 원본을 다시 심고도 걸린 값입니다. 위 원본 범위를 시트에서 직접 확인하세요.\n\n'
        : '') +
      '이어서 "영상 매칭"을 실행하면 파트 영상이 검증 대기 상태로 채워집니다.',
    ui.ButtonSet.OK
  );
}

function ensureBookRow_(ss, bookCode, volume) {
  var sheet = ss.getSheetByName('books');
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  if (sheet.getLastRow() > 1) {
    var codes = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
    for (var i = 0; i < codes.length; i++) {
      if (String(codes[i][0]).trim() === bookCode) return;
    }
  }
  var row = headers.map(function (header) {
    switch (String(header).trim()) {
      case '집코드': return bookCode;
      case '시리즈': return '중앙성가';
      case '권': return volume;
      case '출판사': return '중앙아트';
      case '성부': return 'SATB';
      case '보유': return true;
      default: return '';
    }
  });
  sheet.getRange(sheet.getLastRow() + 1, 1, 1, row.length).setValues([row]);
}

function songsFromCache_(cache, bookCode) {
  var found = {};
  // 같은 곡번호의 제목이 여러 벌이면 "– 소프라노"처럼 구분자로 파트를 뗀 제목을 가장 믿는다.
  // 파트가 곡명에 바로 붙은 옛 형식은 떼어 내도 곡명 끝이 우연히 파트 이름일 수 있다.
  var RANK = { separator: 3, none: 2, tail: 1 };
  for (var i = 0; i < cache.length; i++) {
    var parsed = parseVideoTitle_(cache[i]['제목']);
    // 재생목록명이 1순위, 제목 안의 집 이름이 2순위.
    var entryBook = parsePlaylistBook_(cache[i]['재생목록명']) || parsed.bookCode;
    if (entryBook !== bookCode) continue;
    if (!parsed.number || !parsed.title) continue;
    var rank = RANK[parsed.partFrom] || 0;
    var prev = found[parsed.number];
    if (!prev || rank > prev.rank) found[parsed.number] = { title: parsed.title, rank: rank };
  }
  return Object.keys(found)
    .map(function (n) { return { number: parseInt(n, 10), title: found[n].title }; })
    .sort(function (a, b) { return a.number - b.number; });
}

function parsePastedToc_(text) {
  var out = [];
  var lines = String(text || '').split('\n');
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    if (!line) continue;
    var m = line.match(/^(\d{1,3})\s*(?:[.\t)\-]|\s)\s*(.+)$/);
    if (!m) continue;
    var title = m[2].trim();
    if (title) out.push({ number: parseInt(m[1], 10), title: title });
  }
  return out;
}

function appendSongs_(ss, bookCode, entries, rejected) {
  if (!entries.length) return 0;
  var sheet = ss.getSheetByName('songs');
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];

  var existing = {};
  var codeCol = columnIndex_(sheet, '곡코드');
  if (codeCol && sheet.getLastRow() > 1) {
    var codes = sheet.getRange(2, codeCol, sheet.getLastRow() - 1, 1).getValues();
    for (var i = 0; i < codes.length; i++) existing[String(codes[i][0]).trim()] = true;
  }

  // 곡코드·표시명은 songs 시트의 ARRAYFORMULA가 채운다. 그 열에 값을 쓰면
  // (빈 문자열이라도) 배열 수식이 #REF!로 깨지므로, 그 두 열은 건드리지 않는다.
  var FORMULA_COLUMNS = { '곡코드': true, '표시명': true };

  var rows = [];
  for (var e = 0; e < entries.length; e++) {
    var code = bookCode + '-' + padNumber_(entries[e].number);
    if (existing[code]) continue; // 중복은 곡코드로 skip (§9.3).
    existing[code] = true;
    rows.push(buildSongRow_(headers, bookCode, entries[e], FORMULA_COLUMNS));
  }

  if (!rows.length) return 0;

  // 드롭다운이 걸린 열(집코드·상태·절기·출처)에 허용 밖의 값이 하나라도 있으면
  // setValues가 묶음 전체를 죽인다. 먼저 걸러 내고 무엇이 걸렸는지 남긴다.
  var split = splitByValidation_(sheet, headers, rows);
  if (rejected) {
    split.bad.forEach(function (b) { rejected.push(bookCode + ' — ' + b.reason); });
  }
  rows = split.ok;
  if (!rows.length) return 0;

  var startRow = sheet.getLastRow() + 1;
  // 수식 열을 건너뛰고 연속 구간 단위로만 쓴다.
  var segmentStart = -1;
  for (var c = 0; c <= headers.length; c++) {
    var isFormula = c === headers.length || FORMULA_COLUMNS[String(headers[c]).trim()];
    if (!isFormula && segmentStart === -1) {
      segmentStart = c;
    } else if (isFormula && segmentStart !== -1) {
      var width = c - segmentStart;
      var slice = rows.map(function (row) { return row.slice(segmentStart, c); });
      sheet.getRange(startRow, segmentStart + 1, rows.length, width).setValues(slice);
      segmentStart = -1;
    }
  }

  return rows.length;
}

function buildSongRow_(headers, bookCode, entry, formulaColumns) {
  return headers.map(function (header) {
    var name = String(header).trim();
    if (formulaColumns[name]) return '';
    switch (name) {
      case '제목': return entry.title;
      case '집코드': return bookCode;
      case '수록번호': return entry.number;
      case '성부': return 'SATB';
      case '상태': return '후보';
      case '출처': return 'youtube_channel';
      case '검증': return false;
      default: return '';
    }
  });
}
