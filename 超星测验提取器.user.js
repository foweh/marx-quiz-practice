// ==UserScript==
// @name         超星测验提取器
// @namespace    https://github.com/chaoxing-quiz-extractor
// @version      1.2
// @description  从超星学习通学生页面抓取所有随堂测验题目，合并生成交互式练习 HTML
// @author       Chaoxing Quiz Extractor
// @match        *://*.chaoxing.com/mycourse/studentstudy*
// @match        *://*.chaoxing.com/mycourse/studentstudy?*
// @grant        GM_xmlhttpRequest
// @grant        GM_download
// @connect      mooc1.chaoxing.com
// @connect      mooc2-ans.chaoxing.com
// @run-at       document-end
// ==/UserScript==

(function () {
  'use strict';

  // ===================== 全局状态 =====================
  const HOST = 'https://mooc1.chaoxing.com';
  const HOST_ANS = 'https://mooc2-ans.chaoxing.com';

  let courseId = '';
  let classId = '';
  let cpi = '';
  let courseName = '';

  // 收集的测验数据 [{ chapterTitle, chapterPath, quizzes: [{ title, knowledgeId, questions }] }]
  let allChapters = [];
  let totalQuestions = 0;
  let totalWithAnswers = 0;
  let totalQuizzes = 0;
  let scanDone = false;

  // ===================== DOM 工具 =====================
  function $el(tag, attrs, children) {
    const el = document.createElement(tag);
    if (attrs) Object.entries(attrs).forEach(([k, v]) => {
      if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v);
    });
    if (typeof children === 'string') el.innerHTML = children;
    else if (children) children.forEach(c => el.appendChild(c));
    return el;
  }

  // ===================== UI 面板 =====================
  function injectUI() {
    // 移除已有面板
    const existing = document.getElementById('cxr-panel-v2');
    if (existing) existing.remove();

    const panel = $el('div', { id: 'cxr-panel-v2', style: 'position:fixed;bottom:24px;right:24px;z-index:99999;font-family:system-ui,"PingFang SC","Microsoft YaHei",sans-serif' });

    const fab = $el('div', { id: 'cxrFabV2', class: 'cxr-fab', title: '测验导出' }, '📋');
    Object.assign(fab.style, {
      width: '52px', height: '52px', borderRadius: '50%', background: '#4f46e5',
      color: '#fff', border: 'none', cursor: 'pointer', fontSize: '22px',
      boxShadow: '0 4px 16px rgba(79,70,229,.35)', transition: 'all .2s',
      display: 'flex', alignItems: 'center', justifyContent: 'center'
    });

    const card = $el('div', { id: 'cxrCardV2', style: 'display:none;position:absolute;bottom:64px;right:0;width:320px;background:#fff;border-radius:14px;box-shadow:0 8px 32px rgba(0,0,0,.16);padding:20px;max-height:520px;overflow-y:auto' });

    card.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
        <span style="font-size:15px;font-weight:700;color:#1a1a2e">📦 测验提取器</span>
        <button id="cxrCloseV2" style="background:none;border:none;font-size:18px;cursor:pointer;color:#9ca3af;padding:2px 6px">&times;</button>
      </div>
      <div id="cxrInfoV2" style="font-size:12px;color:#6b7280;margin-bottom:12px;line-height:1.6"></div>
      <div id="cxrBarWrapV2" style="height:5px;background:#e5e7eb;border-radius:3px;overflow:hidden;margin-bottom:8px;display:none">
        <div id="cxrFillV2" style="height:100%;background:linear-gradient(90deg,#4f46e5,#818cf8);width:0%;transition:width .3s;border-radius:3px"></div>
      </div>
      <button id="cxrGoV2" class="cxr-btn-v2" style="display:block;width:100%;padding:11px;border:none;border-radius:10px;font-size:14px;font-weight:600;cursor:pointer;background:#4f46e5;color:#fff;margin-bottom:8px">🔍 扫描章节</button>
      <button id="cxrFetchV2" class="cxr-btn-v2" style="display:none;width:100%;padding:11px;border:none;border-radius:10px;font-size:14px;font-weight:600;cursor:pointer;background:#059669;color:#fff;margin-bottom:8px">📥 开始抓取题目</button>
      <button id="cxrDownloadV2" class="cxr-btn-v2" style="display:none;width:100%;padding:11px;border:none;border-radius:10px;font-size:14px;font-weight:600;cursor:pointer;background:#ea580c;color:#fff">⬇ 下载练习 HTML</button>
      <div id="cxrLogV2" style="display:none;max-height:160px;overflow-y:auto;font-size:11px;color:#6b7280;line-height:1.6;margin-top:8px;background:#f9fafb;border-radius:8px;padding:8px"></div>
    `;

    panel.appendChild(fab);
    panel.appendChild(card);
    document.body.appendChild(panel);

    // 事件绑定
    let open = false;
    fab.addEventListener('click', () => {
      open = !open;
      card.style.display = open ? 'block' : 'none';
      if (open) updateInfo();
    });
    document.getElementById('cxrCloseV2').addEventListener('click', () => {
      open = false;
      card.style.display = 'none';
    });

    document.getElementById('cxrGoV2').addEventListener('click', scanChapters);
    document.getElementById('cxrFetchV2').addEventListener('click', fetchAllQuizzes);
    document.getElementById('cxrDownloadV2').addEventListener('click', downloadHTML);

    // Hover effect on fab
    fab.addEventListener('mouseenter', () => { fab.style.transform = 'scale(1.08)'; });
    fab.addEventListener('mouseleave', () => { fab.style.transform = 'scale(1)'; });

    return { fab, card };
  }

  function updateInfo() {
    const info = document.getElementById('cxrInfoV2');
    if (scanDone) {
      info.innerHTML = `📂 课程: <b>${escHtml(courseName)}</b><br>📝 测验: <b>${totalQuizzes}</b> 个 | 总题数: <b>${totalQuestions}</b> | 有答案: <b>${totalWithAnswers}</b>`;
    } else if (allChapters.length > 0) {
      info.innerHTML = `🔍 已扫描到 <b>${totalQuizzes}</b> 个测验<br>点击「开始抓取题目」获取详情`;
    } else {
      info.innerHTML = '点击「扫描章节」开始分析页面结构';
    }
  }

  function log(msg, isError) {
    const logDiv = document.getElementById('cxrLogV2');
    logDiv.style.display = 'block';
    const div = document.createElement('div');
    div.textContent = msg;
    if (isError) div.style.color = '#dc2626';
    logDiv.appendChild(div);
    logDiv.scrollTop = logDiv.scrollHeight;
  }

  function setProgress(pct) {
    const bar = document.getElementById('cxrBarWrapV2');
    const fill = document.getElementById('cxrFillV2');
    bar.style.display = 'block';
    fill.style.width = Math.min(100, Math.max(0, pct)) + '%';
  }

  function escHtml(s) {
    if (!s) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ===================== 章节扫描 =====================
  function scanChapters() {
    allChapters = [];
    totalQuestions = 0;
    totalWithAnswers = 0;
    totalQuizzes = 0;

    log('🚀 开始扫描章节...');
    document.getElementById('cxrGoV2').textContent = '⏳ 扫描中...';
    document.getElementById('cxrGoV2').disabled = true;
    document.getElementById('cxrBarWrapV2').style.display = 'block';
    document.getElementById('cxrFillV2').style.width = '0%';

    // 从页面中提取 courseId, classId, cpi (多重 fallback)
    // 方法1: 从 script 标签中提取
    const scripts = document.querySelectorAll('script');
    for (const s of scripts) {
      const txt = s.textContent || '';
      if (!cpi) { const m = txt.match(/var\s+stu_cpi\s*=\s*["'](\d+)["']/); if (m) cpi = m[1]; }
      if (!classId) { const m = txt.match(/var\s+stu_clazzId\s*=\s*["'](\d+)["']/); if (m) classId = m[1]; }
      if (!courseId) { const m = txt.match(/var\s+stu_CourseId\s*=\s*["'](\d+)["']/); if (m) courseId = m[1]; }
    }
    // 方法2: 从 URL 参数提取
    const urlParams = new URLSearchParams(location.search);
    if (!cpi) cpi = urlParams.get('cpi') || '';
    if (!classId) classId = urlParams.get('clazzid') || urlParams.get('classId') || '';
    if (!courseId) courseId = urlParams.get('courseId') || urlParams.get('courseid') || '';
    // 方法3: 从全局变量
    if (!cpi && typeof window._cpi !== 'undefined') cpi = String(window._cpi);

    // 获取课程名称
    const titleEl = document.querySelector('.courseName') || document.querySelector('title');
    if (titleEl) courseName = titleEl.textContent.replace(/^\s+|\s+$/g, '').replace(/\n/g, ' ').substring(0, 60);

    // 扫描所有章节节点
    const catalogItems = document.querySelectorAll('.posCatalog_name');
    const chapters = [];
    let chapterStack = [{ title: '根', level: 0 }];

    catalogItems.forEach(el => {
      const onclick = (el.getAttribute('onclick') || '').replace(/&#39;/g, "'").replace(/&quot;/g, '"');
      const match = onclick.match(/getTeacherAjax\s*\(\s*['"](\d+)['"]\s*,\s*['"](\d+)['"]\s*,\s*['"](\d+)['"]\s*\)/);
      if (!match) return;

      const cId = match[1];
      const clId = match[2];
      const kId = match[3];
      const title = (el.getAttribute('title') || el.textContent || '').trim();
      const sbar = el.querySelector('.posCatalog_sbar');
      const sectionNum = sbar ? sbar.textContent.trim() : '';

      // 确认是测验节点（标题含测验关键词）
      if (/测验|测试|考试|作业/.test(title)) {
        chapters.push({
          sectionNum,
          chapterTitle: title,
          knowledgeId: kId,
          courseId: cId,
          classId: clId,
          chapterPath: sectionNum + ' ' + title
        });
      }
    });

    totalQuizzes = chapters.length;
    allChapters = chapters.map(c => ({
      ...c,
      quizzes: [{ title: c.chapterTitle, knowledgeId: c.knowledgeId, questions: [], hasAnswers: null, fetched: false }]
    }));

    log(`✅ 扫描完成: ${totalQuizzes} 个测验节点`);
    updateInfo();

    document.getElementById('cxrGoV2').textContent = '🔄 重新扫描';
    document.getElementById('cxrGoV2').disabled = false;
    document.getElementById('cxrFetchV2').style.display = 'block';
    document.getElementById('cxrBarWrapV2').style.display = 'none';
    scanDone = true;

    if (totalQuizzes === 0) {
      log('⚠️ 未找到测验节点，请确认在正确的页面上', true);
    }
  }

  // ===================== API 请求 =====================
  function gmFetch(url, timeout) {
    return new Promise((resolve, reject) => {
      const fullUrl = url.startsWith('http') ? url : HOST + url;
      GM_xmlhttpRequest({
        method: 'GET',
        url: fullUrl,
        headers: {
          'Accept': 'text/html,application/xhtml+xml,application/json,*/*',
        },
        timeout: timeout || 15000,
        onload: function (resp) {
          if (resp.status >= 200 && resp.status < 400) {
            resolve({ html: resp.responseText, finalUrl: resp.finalUrl || fullUrl, status: resp.status });
          } else {
            reject(new Error(`HTTP ${resp.status}`));
          }
        },
        onerror: function (e) { reject(new Error('Network error: ' + (e.error || 'unknown'))); },
        ontimeout: function () { reject(new Error('Timeout')); }
      });
    });
  }

  // 第1步: 获取 cards 页, 提取 mArg 中的 attachment 数据
  async function fetchCardsPage(knowledgeId) {
    const url = `/mooc-ans/knowledge/cards?clazzid=${classId}&courseid=${courseId}&knowledgeid=${knowledgeId}&num=0&ut=s&cpi=${cpi}&mooc2=1&isMicroCourse=false&editorPreview=0`;
    const resp = await gmFetch(url);
    return resp.html;
  }

  function parseMAttachments(html) {
    // 提取 mArg JSON
    const m = html.match(/mArg\s*=\s*({[\s\S]*?});/);
    if (!m) return null;
    try {
      const mArg = JSON.parse(m[1]);
      const attachments = (mArg.attachments || []).filter(a => a.type === 'workid' && a.property && a.property.workid);
      return {
        attachments,
        defaults: mArg.defaults || {},
        knowledgename: mArg.knowledgename || ''
      };
    } catch (e) {
      return null;
    }
  }

  // 第2步: 获取 work 页面 (可能重定向到已批阅页面)
  async function fetchWorkPage(workid, jobid, enc, knowledgeId, ktoken) {
    const url = `/mooc-ans/api/work?api=1&workId=${workid}&jobid=${jobid}&originJobId=${jobid}&needRedirect=true&skipHeader=true&knowledgeid=${knowledgeId}&ktoken=${ktoken}&cpi=${cpi}&ut=s&clazzId=${classId}&mooc2=1&courseid=${courseId}&enc=${enc}`;
    const resp = await gmFetch(url);
    return resp;
  }

  // ===================== HTML 解析 =====================
  function parseQuestionsFromHTML(html) {
    // 使用 DOMParser 解析
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const questions = [];

    // 查找题目容器
    const qDivs = doc.querySelectorAll('.TiMu.newTiMu');
    if (qDivs.length === 0) {
      // 尝试其他选择器
      const altDivs = doc.querySelectorAll('.TiMu');
      if (altDivs.length === 0) return { questions: [], hasAnswers: false };
    }

    (qDivs.length ? qDivs : doc.querySelectorAll('.TiMu')).forEach((div, idx) => {
      const q = { id: idx + 1 };

      // 题型识别
      if (div.classList.contains('singleQuesId')) q.type = '单选题';
      else if (div.classList.contains('multiQuesId')) q.type = '多选题';
      else if (div.classList.contains('trueOrFalseQuesId')) q.type = '判断题';
      else if (div.classList.contains('inputQuesId') || div.querySelector('.Zy_ulTk')) q.type = '填空题';
      else if (div.querySelector('.matching')) q.type = '连线题';
      else if (div.querySelector('.newSort')) q.type = '排序题';
      else q.type = '未知题型';

      // 题干
      const typeSpan = div.querySelector('.newZy_TItle');
      const textEl = div.querySelector('.qtContent p') || div.querySelector('.qtContent');
      if (textEl) {
        q.text = textEl.textContent.replace(/\s+/g, ' ').trim();
      } else {
        const titleDiv = div.querySelector('.Zy_TItle');
        q.text = titleDiv ? titleDiv.textContent.replace(/^\d+\s*/, '').replace(/\s+/g, ' ').trim() : '';
      }

      // 选项 (单选题/多选题/判断题)
      const optionEls = div.querySelectorAll('.Zy_ulTop li');
      if (optionEls.length > 0) {
        q.options = [];
        optionEls.forEach(li => {
          const labelEl = li.querySelector('i');
          const contentEl = li.querySelector('a p') || li.querySelector('a') || li;
          const label = labelEl ? labelEl.textContent.replace(/[、,，\s]$/, '').trim() : '';
          const text = contentEl ? contentEl.textContent.replace(/\s+/g, ' ').trim() : '';
          if (label || text) q.options.push({ label, text: text || label });
        });
      }

      // 填空题处理
      if (q.type === '填空题') {
        const tkInputs = div.querySelectorAll('.Zy_ulTk input, .Zy_ulTk textarea, .InpDIV input');
        if (tkInputs.length > 0) {
          q.blankCount = tkInputs.length;
        }
      }

      // 正确答案
      const correctDiv = div.querySelector('.correctAnswer .answerCon');
      const myAnswerDiv = div.querySelector('.myAnswer .answerCon');

      if (correctDiv) {
        q.answer = correctDiv.textContent.replace(/\s+/g, ' ').trim();
        q.hasAnswer = true;
      } else if (myAnswerDiv) {
        q.myAnswer = myAnswerDiv.textContent.replace(/\s+/g, ' ').trim();
        q.hasAnswer = false;
        q.answer = '';
      } else {
        q.hasAnswer = false;
        q.answer = '';
      }

      // 解析 / 知识点
      const kpDiv = div.querySelector('.knowledgePointBx');
      if (kpDiv) {
        const kpLinks = kpDiv.querySelectorAll('.knowledgeList li a');
        if (kpLinks.length > 0) {
          q.knowledge = Array.from(kpLinks).map(a => a.textContent.trim()).filter(Boolean).join(' | ');
        }
      }

      // 分数
      const scoreEl = div.querySelector('.scoreNum');
      if (scoreEl) {
        q.score = scoreEl.textContent.trim();
      }

      // 对错标记
      const markingEl = div.querySelector('.marking_dui, .marking_cuo, .marking_bandui');
      if (markingEl) {
        if (markingEl.classList.contains('marking_dui')) q.isCorrect = true;
        else if (markingEl.classList.contains('marking_cuo')) q.isCorrect = false;
      }

      questions.push(q);
    });

    // 判断是否有正确答案
    const hasAnswers = questions.some(q => q.hasAnswer);
    return { questions, hasAnswers };
  }

  // ===================== 主抓取流程 =====================
  async function fetchAllQuizzes() {
    if (allChapters.length === 0) {
      log('⚠️ 请先扫描章节', true);
      return;
    }

    totalQuestions = 0;
    totalWithAnswers = 0;
    document.getElementById('cxrFetchV2').disabled = true;
    document.getElementById('cxrFetchV2').textContent = '⏳ 抓取中...';
    document.getElementById('cxrLogV2').style.display = 'block';
    log('📥 开始抓取题目数据...');

    const total = allChapters.length;
    let completed = 0;

    for (const chapter of allChapters) {
      const quiz = chapter.quizzes[0];
      if (!quiz || quiz.fetched) {
        completed++;
        continue;
      }

      try {
        log(`  🔍 [${chapter.sectionNum}] ${chapter.chapterTitle}`);

        // Step 1: 获取 cards 页面
        const cardsHtml = await fetchCardsPage(quiz.knowledgeId);
        const mData = parseMAttachments(cardsHtml);

        if (!mData || mData.attachments.length === 0) {
          log(`    ⚠️ 无测验数据`, true);
          quiz.fetched = true;
          quiz.hasAnswers = false;
          chapter.chapterTitle = chapter.sectionNum + ' ' + chapter.chapterTitle;
          completed++;
          setProgress((completed / total) * 100);
          continue;
        }

        // 收集此章节下所有 work 的题目
        let chapterQuestions = [];
        let chapterHasAnswers = false;

        for (const att of mData.attachments) {
          try {
            const workid = att.property.workid;
            const jobid = att.property.jobid || att.jobid;
            const enc = att.enc || '';
            const ktoken = (mData.defaults && mData.defaults.ktoken) || '';

            // Step 2: 获取 work 页面
            const workResp = await fetchWorkPage(workid, jobid, enc, quiz.knowledgeId, ktoken);

            // Step 3: 解析题目
            const result = parseQuestionsFromHTML(workResp.html);

            if (result.questions.length > 0) {
              chapterQuestions = chapterQuestions.concat(result.questions);
              if (result.hasAnswers) chapterHasAnswers = true;
            }
          } catch (e) {
            log(`    ⚠️ 子测验请求失败: ${e.message}`, true);
          }
        }

        quiz.questions = chapterQuestions;
        quiz.hasAnswers = chapterHasAnswers;
        quiz.fetched = true;
        quiz.title = mData.attachments[0] && mData.attachments[0].property.title ?
          mData.attachments[0].property.title : chapter.chapterTitle;

        if (chapterQuestions.length > 0) {
          const ansCount = chapterQuestions.filter(q => q.hasAnswer).length;
          totalQuestions += chapterQuestions.length;
          totalWithAnswers += ansCount;
          log(`    ✅ ${chapterQuestions.length} 题 (${ansCount} 有答案) [${quiz.title}]`);
        } else {
          log(`    📭 无题目`, true);
        }

      } catch (e) {
        log(`    ❌ 抓取失败: ${e.message}`, true);
        quiz.fetched = true;
        quiz.hasAnswers = false;
      }

      completed++;
      setProgress((completed / total) * 100);

      // 请求间延迟避免限流
      await sleep(300 + Math.random() * 400);
    }

    document.getElementById('cxrFetchV2').disabled = false;
    document.getElementById('cxrFetchV2').textContent = '🔄 重新抓取';
    document.getElementById('cxrDownloadV2').style.display = 'block';
    document.getElementById('cxrBarWrapV2').style.display = 'none';
    scanDone = true;
    updateInfo();
    log(`🎉 抓取完成! ${totalQuestions} 题, ${totalWithAnswers} 有答案`);
  }

  function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  // ===================== HTML 生成 =====================
  function generatePracticeHTML() {
    const chaptersWithQuestions = allChapters.filter(c =>
      c.quizzes[0] && c.quizzes[0].questions && c.quizzes[0].questions.length > 0
    );

    if (chaptersWithQuestions.length === 0) {
      alert('没有可导出的题目，请先抓取数据');
      return '';
    }

    // 扁平化所有题目并分配全局ID
    let globalId = 0;
    const allQ = [];
    const sections = [];

    chaptersWithQuestions.forEach(ch => {
      const qq = ch.quizzes[0].questions;
      const sectionQuestions = qq.map(q => {
        globalId++;
        return {
          ...q,
          globalId,
          sectionTitle: ch.quizzes[0].title || ch.chapterTitle,
          sectionPath: ch.chapterTitle,
          hasAnswer: q.hasAnswer || false
        };
      });
      sections.push({
        title: ch.quizzes[0].title || ch.chapterTitle,
        path: ch.chapterTitle,
        questions: sectionQuestions,
        hasAnswers: ch.quizzes[0].hasAnswers
      });
      allQ.push(...sectionQuestions);
    });

    const total = allQ.length;
    const withAns = allQ.filter(q => q.hasAnswer).length;

    const questionsJSON = JSON.stringify(allQ.map(q => ({
      id: q.globalId,
      type: q.type,
      text: q.text,
      options: q.options || [],
      answer: q.answer || '',
      hasAnswer: q.hasAnswer,
      knowledge: q.knowledge || '',
      sectionTitle: q.sectionTitle,
      sectionPath: q.sectionPath,
      blankCount: q.blankCount || 0
    })));

    const sectionsJSON = JSON.stringify(sections.map(s => ({
      title: s.title,
      path: s.path,
      hasAnswers: s.hasAnswers,
      questionIds: s.questions.map(q => q.globalId)
    })));

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>练习 - ${escHtml(courseName)}</title>
<style>
:root{--bg:#f0f2f5;--card:#fff;--txt:#1a1a2e;--t2:#6b7280;--pri:#4f46e5;--ok:#059669;--err:#dc2626;--brd:#e5e7eb;--hover:#f3f4f6}
.dark{--bg:#111827;--card:#1f2937;--txt:#f9fafb;--t2:#9ca3af;--pri:#818cf8;--ok:#34d399;--err:#f87171;--brd:#374151;--hover:#374151}
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:system-ui,"PingFang SC","Microsoft YaHei",sans-serif;background:var(--bg);color:var(--txt);padding:20px 16px 40px}
.container{max-width:800px;margin:0 auto}
.topbar{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:16px}
.topbar h1{font-size:22px;font-weight:700}
.topbar .meta{font-size:13px;color:var(--t2)}
.toolbar{display:flex;gap:8px;flex-wrap:wrap}
.btn{padding:8px 16px;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;transition:all .15s}
.btn:active{transform:scale(.97)}
.btn-pri{background:var(--pri);color:#fff}
.btn-out{background:var(--card);color:var(--pri);border:2px solid var(--pri)}
.btn-sm{padding:4px 10px;font-size:12px}
.score-bar{background:var(--card);border-radius:12px;padding:14px 18px;margin-bottom:16px;display:flex;justify-content:space-between;align-items:center;box-shadow:0 1px 4px rgba(0,0,0,.06)}
.score-bar .lbl{font-size:14px;color:var(--t2)}
.score-bar .num{font-size:26px;font-weight:700;color:var(--pri)}
.score-bar .num.green{color:var(--ok)}
.score-bar .num.red{color:var(--err)}
.section{margin-bottom:8px}
.section-h{cursor:pointer;display:flex;align-items:center;gap:8px;padding:10px 16px;background:var(--card);border-radius:10px;font-size:14px;font-weight:600;border:1px solid var(--brd);user-select:none;transition:background .15s}
.section-h:hover{background:var(--hover)}
.section-h .arrow{transition:transform .2s;font-size:12px;color:var(--t2)}
.section-h.collapsed .arrow{transform:rotate(-90deg)}
.section-h .badge{font-size:11px;padding:2px 8px;border-radius:10px;font-weight:500;margin-left:auto}
.section-h .badge.ok{background:#d1fae5;color:#065f46}
.section-h .badge.no{background:#fef3c7;color:#92400e}
.dark .section-h .badge.ok{background:#064e3b;color:#6ee7b7}
.dark .section-h .badge.no{background:#78350f;color:#fcd34d}
.section-body{overflow:hidden;transition:max-height .35s ease}
.section-body.hidden{max-height:0}
.section-body .inner{padding-top:8px}
.card{background:var(--card);border-radius:10px;padding:18px;margin-bottom:10px;border:1px solid var(--brd)}
.q-head{display:flex;align-items:baseline;gap:8px;margin-bottom:10px;flex-wrap:wrap}
.q-num{background:var(--pri);color:#fff;width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;flex-shrink:0}
.q-type{font-size:11px;color:var(--pri);background:#eef2ff;padding:2px 8px;border-radius:4px;font-weight:600}
.dark .q-type{background:#312e81;color:#a5b4fc}
.q-text{font-size:15px;line-height:1.6;font-weight:500;flex:1;min-width:200px}
.no-ans{display:inline-block;font-size:10px;background:#fef3c7;color:#92400e;padding:1px 6px;border-radius:4px;margin-left:6px;vertical-align:middle}
.dark .no-ans{background:#78350f;color:#fcd34d}
.options{display:flex;flex-direction:column;gap:6px;margin:6px 0}
.opt{display:flex;align-items:center;padding:9px 12px;border:2px solid var(--brd);border-radius:8px;cursor:pointer;transition:all .12s;font-size:14px;line-height:1.4}
.opt:hover{border-color:var(--pri);background:var(--hover)}
.opt .o-label{font-weight:700;color:var(--t2);margin-right:8px;min-width:20px}
.opt.selected{border-color:var(--pri);background:#eef2ff}
.dark .opt.selected{background:#312e81}
.opt.correct{border-color:var(--ok);background:#d1fae5}
.dark .opt.correct{background:#064e3b}
.opt.wrong{border-color:var(--err);background:#fee2e2}
.dark .opt.wrong{background:#7f1d1d}
.opt.done{cursor:default}
.result{margin-top:8px;padding:8px 12px;border-radius:8px;font-size:13px;display:none}
.result.show{display:block}
.result.ok{background:#d1fae5;color:#065f46}
.dark .result.ok{background:#064e3b;color:#6ee7b7}
.result.err{background:#fee2e2;color:#991b1b}
.dark .result.err{background:#7f1d1d;color:#fca5a5}
.result .hint{margin-top:2px;font-size:12px;color:inherit;opacity:.8}
.edit-ans{margin-top:6px;display:flex;gap:8px;align-items:center}
.edit-ans input{flex:1;padding:6px 10px;border:1px solid var(--brd);border-radius:6px;font-size:13px;background:var(--card);color:var(--txt)}
.edit-ans .btn-sm{padding:4px 12px}
.manual-ans{font-size:12px;color:var(--ok);margin-top:4px;font-style:italic}
@media(max-width:500px){body{padding:12px 8px}.card{padding:12px}.q-text{font-size:14px}.opt{font-size:13px;padding:7px 10px}}
</style>
</head>
<body>
<div class="container">
<div class="topbar">
  <div>
    <h1>📝 ${escHtml(courseName)}</h1>
    <div class="meta">共 ${total} 题 · ${withAns} 题有答案 · ${sections.length} 个章节 · ${new Date().toLocaleDateString('zh-CN')}</div>
  </div>
  <div class="toolbar">
    <button class="btn btn-out btn-sm" id="toggleDark" title="切换暗色模式">🌓</button>
    <button class="btn btn-out btn-sm" id="collapseAll">📂 折叠全部</button>
    <button class="btn btn-out btn-sm" id="expandAll">📖 展开全部</button>
    <button class="btn btn-out btn-sm" id="resetAll">🔄 重置</button>
  </div>
</div>
<div class="score-bar">
  <span class="lbl">练习得分</span>
  <span class="num" id="scoreDisplay">— / ${total}</span>
  <span class="lbl" style="text-align:right">已答: <b id="answeredCount">0</b> / ${total}</span>
</div>
<div id="sectionsContainer"></div>
<div style="text-align:center;margin-top:20px">
  <button class="btn btn-pri" id="submitAll" style="font-size:15px;padding:12px 36px">📋 提交全部答案</button>
</div>
</div>
<script>
var QUESTIONS = ${questionsJSON};
var SECTIONS = ${sectionsJSON};
var TOTAL = ${total};
var userAnswers = new Array(TOTAL + 1).fill(null);
var submitted = false;

function renderAll(){
  var container = document.getElementById('sectionsContainer');
  var html = '';
  SECTIONS.forEach(function(sec, si){
    var qIds = sec.questionIds;
    var secAns = qIds.filter(function(id){ var q = QUESTIONS.find(function(x){return x.id===id}); return q && q.hasAnswer; }).length;
    var secTotal = qIds.length;
    html += '<div class="section">';
    html += '<div class="section-h" data-si="'+si+'"><span class="arrow">▼</span>'+escHtml(sec.title)+' <span style="color:var(--t2);font-size:12px;font-weight:400">('+secTotal+'题)</span><span class="badge '+(sec.hasAnswers?'ok':'no')+'">'+(sec.hasAnswers?'有答案':'待补充')+'</span></div>';
    html += '<div class="section-body"><div class="inner">';
    qIds.forEach(function(qid){
      var q = QUESTIONS.find(function(x){return x.id===qid});
      if(!q) return;
      var selected = userAnswers[q.id];
      var hasRes = submitted && selected !== null && q.hasAnswer;
      html += '<div class="card" id="qcard'+q.id+'">';
      html += '<div class="q-head"><span class="q-num">'+q.id+'</span><span class="q-type">'+escHtml(q.type)+'</span><span class="q-text">'+escHtml(q.text)+(q.hasAnswer?'':' <span class="no-ans">答案待补充</span>')+'</span></div>';
      if(q.options && q.options.length>0){
        html += '<div class="options">';
        var labels = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        q.options.forEach(function(opt,oi){
          var cls = 'opt';
          if(selected===oi) cls+=' selected';
          if(hasRes){
            cls+=' done';
            var ansLabel = q.answer ? q.answer.trim().charAt(0) : '';
            if(opt.label === ansLabel || opt.label.charAt(0) === ansLabel) cls+=' correct';
            else if(selected===oi) cls+=' wrong';
          }
          html += '<div class="'+cls+'" data-qid="'+q.id+'" data-oi="'+oi+'"><span class="o-label">'+escHtml(opt.label||labels.charAt(oi))+'.</span><span>'+escHtml(opt.text)+'</span></div>';
        });
        html += '</div>';
      } else if(q.type==='填空题' || q.type==='判断题'){
        html += '<div style="margin:6px 0"><input type="text" placeholder="输入你的答案" style="width:100%;padding:8px 12px;border:1px solid var(--brd);border-radius:6px;font-size:14px;background:var(--card);color:var(--txt)" data-qid="'+q.id+'" class="fillInput" value="'+(selected||'')+'"></div>';
      }
      if(!q.hasAnswer && selected){
        html += '<div class="manual-ans">✏️ 你的答案: '+escHtml(String(selected))+'</div>';
      }
      if(hasRes){
        var ansLabel = q.answer || '';
        var isCorrect = selected!==null && (String(selected)===ansLabel || String.fromCharCode(65+selected)===ansLabel);
        html += '<div class="result show '+(isCorrect?'ok':'err')+'"><strong>'+(isCorrect?'✅ 正确':'❌ 错误')+'</strong><div class="hint">正确答案: '+escHtml(ansLabel)+(q.knowledge?'<br>💡 '+escHtml(q.knowledge):'')+'</div></div>';
      } else if(submitted && !q.hasAnswer){
        html += '<div class="result show" style="background:#fef3c7;color:#92400e;display:block"><strong>⚠️ 暂无正确答案</strong><div class="hint">可自行填写答案保存到本地</div></div>';
      }
      if(!q.hasAnswer && !submitted){
        html += '<div class="edit-ans"><input type="text" placeholder="手动填入正确答案" data-qid="'+q.id+'" class="manualInput"><button class="btn btn-pri btn-sm manualSaveBtn" data-qid="'+q.id+'">保存</button></div>';
      }
      html += '</div>';
    });
    html += '</div></div></div>';
  });
  container.innerHTML = html;

  // 绑定点击
  if(!submitted){
    document.querySelectorAll('.opt:not(.done)').forEach(function(el){
      el.addEventListener('click',function(){
        var qid = parseInt(this.dataset.qid);
        var oi = parseInt(this.dataset.oi);
        var q = QUESTIONS.find(function(x){return x.id===qid});
        if(q && q.type==='多选题'){
          // 多选: 切换
          var cur = userAnswers[qid];
          if(!cur || !Array.isArray(cur)) cur = cur!==null ? [cur] : [];
          var idx = cur.indexOf(oi);
          if(idx>=0) cur.splice(idx,1); else cur.push(oi);
          if(cur.length===0) cur = null;
          userAnswers[qid] = cur;
        } else {
          userAnswers[qid] = oi;
        }
        renderAll();
      });
    });
    document.querySelectorAll('.fillInput').forEach(function(el){
      el.addEventListener('input',function(){
        var qid = parseInt(this.dataset.qid);
        userAnswers[qid] = this.value;
      });
    });
    document.querySelectorAll('.manualSaveBtn').forEach(function(el){
      el.addEventListener('click',function(){
        var qid = parseInt(this.dataset.qid);
        var input = document.querySelector('.manualInput[data-qid="'+qid+'"]');
        if(input && input.value.trim()){
          var q = QUESTIONS.find(function(x){return x.id===qid});
          if(q){ q.answer = input.value.trim(); q.hasAnswer = true; }
          // 保存到 localStorage
          try{
            var saved = JSON.parse(localStorage.getItem('cxr_answers')||'{}');
            saved[qid] = input.value.trim();
            localStorage.setItem('cxr_answers',JSON.stringify(saved));
          }catch(e){}
          renderAll();
        }
      });
    });
  }

  // 折叠/展开
  document.querySelectorAll('.section-h').forEach(function(el){
    el.addEventListener('click',function(){
      var body = this.nextElementSibling;
      var hidden = body.classList.toggle('hidden');
      this.classList.toggle('collapsed',hidden);
    });
  });

  updateScore();
}

function updateScore(){
  var answered = 0, correct = 0;
  QUESTIONS.forEach(function(q){
    if(!q.hasAnswer) return;
    var sel = userAnswers[q.id];
    if(sel===null || sel===undefined) return;
    answered++;
    var ans = q.answer ? q.answer.trim() : '';
    if(String(sel)===ans || String.fromCharCode(65+parseInt(sel))===ans || (Array.isArray(sel) && sel.sort().join(',')===ans.split(/[,，]+/).sort().join(','))) correct++;
  });
  var totalAns = QUESTIONS.filter(function(q){return q.hasAnswer;}).length;
  document.getElementById('scoreDisplay').textContent = answered>0 ? correct+' / '+totalAns : '— / '+totalAns;
  var sd = document.getElementById('scoreDisplay');
  sd.className = 'num' + (answered>0 ? (correct/totalAns>=0.6?' green':' red') : '');
  document.getElementById('answeredCount').textContent = answered;
}

function escHtml(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}

// 从 localStorage 加载已保存的答案
function loadSavedAnswers(){
  try{
    var saved = JSON.parse(localStorage.getItem('cxr_answers')||'{}');
    QUESTIONS.forEach(function(q){
      if(!q.hasAnswer && saved[q.id]){
        q.answer = saved[q.id];
        q.hasAnswer = true;
      }
    });
  }catch(e){}
}

document.getElementById('submitAll').addEventListener('click',function(){
  submitted = true;
  renderAll();
});
document.getElementById('resetAll').addEventListener('click',function(){
  userAnswers = new Array(TOTAL+1).fill(null);
  submitted = false;
  renderAll();
});
document.getElementById('collapseAll').addEventListener('click',function(){
  document.querySelectorAll('.section-body').forEach(function(b){b.classList.add('hidden');});
  document.querySelectorAll('.section-h').forEach(function(h){h.classList.add('collapsed');});
});
document.getElementById('expandAll').addEventListener('click',function(){
  document.querySelectorAll('.section-body').forEach(function(b){b.classList.remove('hidden');});
  document.querySelectorAll('.section-h').forEach(function(h){h.classList.remove('collapsed');});
});
document.getElementById('toggleDark').addEventListener('click',function(){
  document.documentElement.classList.toggle('dark');
  try{localStorage.setItem('cxr_dark',document.documentElement.classList.contains('dark')?'1':'0');}catch(e){}
});

// 初始化
loadSavedAnswers();
if((localStorage.getItem('cxr_dark')||'0')==='1') document.documentElement.classList.add('dark');
renderAll();
</script>
</body>
</html>`;
  }

  function downloadHTML() {
    if (totalQuestions === 0) {
      alert('没有题目可导出，请先抓取数据');
      return;
    }

    const html = generatePracticeHTML();
    if (!html) return;

    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const safeName = (courseName || '练习').replace(/[\\/:*?"<>|]/g, '_').substring(0, 40);
    a.href = url;
    a.download = safeName + '_全部题目_' + new Date().toISOString().slice(0, 10) + '.html';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    log('✅ HTML 文件已下载!');
  }

  // ===================== 初始化 =====================
  function init() {
    // 等待页面加载完成
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
      return;
    }

    // 注入 UI
    injectUI();
    log('✅ 超星测验提取器已就绪');
    updateInfo();
  }

  init();
})();
