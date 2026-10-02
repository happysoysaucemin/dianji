/* 记电 · 登录密码生成工具（Node，无第三方依赖）
   ------------------------------------------------------------------
   用法：
     node tools/make-passwords.js <TOKEN> 姓名:用户标识:位移 [姓名:用户标识:位移 ...] \
          [--write] [--out=文件] [--dry]

   示例：
     node tools/make-passwords.js github_pat_xxx \
       郑沐鑫:C446A4792EE0D86D9F1230424C610BCF:3 \
       商叶航:5CEA059E725F5414F4177D42859E4748:1 \
       --write --out=D:/web/dianji-passwords.txt

   生成规则（与 js/auth.js 完全一致）：
     密码 = 交错(用户标识, 凯撒(token, 位移))
     交错：前 min(32, len(密文)) 对交替，剩余密文原样追加
     凯撒：数字在 0-9 内循环，小写 a-z 内循环，大写 A-Z 内循环，其它字符不动

   参数：
     --write       把名单（姓名/标识/位移）回写到 js/auth-table.js
     --out=<文件>  把生成的登录密码写到仓库外的文件（推荐），避免密码进入终端与日志
     --dry         不写任何文件

   安全提示：TOKEN 只作为命令行参数存在，不会写入仓库任何文件。
   ------------------------------------------------------------------ */
'use strict';

var fs = require('fs');
var path = require('path');

require(path.join(__dirname, '..', 'js', 'auth.js'));
var DJ = globalThis.DJ;

/** 生成各成员的密码与名单 */
function build(token, members) {
  var entries = members.map(function (m) {
    if (!m.id) throw new Error('成员「' + m.by + '」缺少用户标识');
    var shift = Number(m.shift);
    if (!isFinite(shift)) throw new Error('成员「' + m.by + '」的位移不是数字');
    return {
      by: m.by,
      id: String(m.id),
      shift: shift,
      password: DJ.auth.encodePassword(token, String(m.id), shift)
    };
  });
  var table = entries.map(function (e) { return { by: e.by, id: e.id, shift: e.shift }; });
  return { entries: entries, table: table };
}

/** 回写 js/auth-table.js（只写名单，不含 token） */
function writeTableFile(file, built) {
  var lines = [];
  lines.push('/* 记电 · 登录密码名单（由 tools/make-passwords.js 生成，请勿手工编辑）');
  lines.push('   ------------------------------------------------------------------');
  lines.push('   这里**只有用户标识 ID 与该成员的凯撒位移**，不含任何 token 片段。');
  lines.push('   密码本体 = 交错(ID, 凯撒(token, 位移))，token 不会被写进这个文件。');
  lines.push('   ------------------------------------------------------------------ */');
  lines.push('(function (global) {');
  lines.push("  'use strict';");
  lines.push('  var DJ = global.DJ = global.DJ || {};');
  lines.push('  DJ.authTable = [');
  built.table.forEach(function (t) {
    lines.push("    { by: '" + t.by.replace(/'/g, "\\'") + "', id: '" + t.id + "', shift: " + t.shift + ' },');
  });
  lines.push('  ];');
  lines.push("})(typeof window !== 'undefined' ? window : globalThis);");
  lines.push('');
  fs.writeFileSync(file, lines.join('\n'), 'utf8');
  return file;
}

/** 把密码写到仓库外的文件 */
function writePasswordFile(file, built) {
  var out = [];
  out.push('记电 · 登录密码（分发完成后请立即删除本文件）');
  out.push('生成时间：' + new Date().toLocaleString('zh-CN'));
  out.push('每份密码只能发给对应本人；它能被反解出完整 token。');
  out.push('');
  out.push('姓名\t标识\t位移\t登录密码');
  built.entries.forEach(function (e) {
    out.push(e.by + '\t' + e.id + '\t' + e.shift + '\t' + e.password);
  });
  out.push('');
  fs.writeFileSync(file, out.join('\n'), 'utf8');
  return file;
}

function parseArgs(argv) {
  var out = { token: null, members: [], write: false, dry: false, outFile: null };
  argv.forEach(function (a) {
    if (a === '--write') { out.write = true; return; }
    if (a === '--dry') { out.dry = true; return; }
    var mo = /^--out=(.+)$/.exec(a);
    if (mo) { out.outFile = mo[1]; return; }
    var mm = /^([^:]+):([^:]+):(\d+)$/.exec(a);
    if (mm) { out.members.push({ by: mm[1], id: mm[2], shift: parseInt(mm[3], 10) }); return; }
    if (!out.token) { out.token = a; return; }
    throw new Error('无法识别的参数：' + a);
  });
  return out;
}

function main() {
  var opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(e.message);
    process.exit(2);
  }
  if (!opts.token || !opts.members.length) {
    console.error('用法：node tools/make-passwords.js <TOKEN> 姓名:用户标识:位移 [...] [--write] [--out=文件]');
    process.exit(2);
  }

  var built = build(opts.token, opts.members);

  console.log('');
  console.log('共 ' + built.entries.length + ' 人');
  built.entries.forEach(function (e) {
    console.log('  ' + e.by + '  标识=' + e.id + '  位移=' + e.shift
      + '  密码长度=' + e.password.length);
  });

  if (opts.outFile) {
    writePasswordFile(opts.outFile, built);
    console.log('登录密码已写入（未打印到终端）：' + opts.outFile);
    console.log('请分别私下发给本人，分发完成后删除该文件 —— 它能被反解出完整 token。');
  } else if (opts.dry) {
    console.log('（--dry：未写任何文件）');
  } else {
    console.log('');
    console.log('姓名\t登录密码');
    built.entries.forEach(function (e) { console.log(e.by + '\t' + e.password); });
  }

  if (opts.write && !opts.dry) {
    var f = path.join(__dirname, '..', 'js', 'auth-table.js');
    writeTableFile(f, built);
    console.log('已回写名单：' + f);
  } else {
    console.log('（未写名单。加 --write 可回写 js/auth-table.js）');
  }
  console.log('');
}

module.exports = {
  build: build,
  writeTableFile: writeTableFile,
  writePasswordFile: writePasswordFile,
  parseArgs: parseArgs
};

if (require.main === module) main();
