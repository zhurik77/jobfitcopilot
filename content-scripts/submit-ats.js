// Job Fit Copilot — универсальный скрипт отклика на вакансию.
// Внедряется динамически через chrome.scripting.executeScript или уже
// присутствует как статический content-script.
(function () {
  if (window.__jfcSubmitInstalled) return;
  window.__jfcSubmitInstalled = true;

  /**
   * Определяет сайт по URL и возвращает набор селекторов и логику заполнения.
   */
  function detectSite(url) {
    try {
      const host = new URL(url).hostname.toLowerCase();
      if (host === 'hh.ru' || host.endsWith('.hh.ru')) return 'hh';
      if (host === 'linkedin.com' || host.endsWith('.linkedin.com')) return 'linkedin';
      if (host === 'upwork.com' || host.endsWith('.upwork.com')) return 'upwork';
    } catch (_) { /* ignore */ }
    return null;
  }

  /**
   * Заполняет форму отклика на hh.ru и отправляет.
   * Селекторы сверены с живой вёрсткой hh.ru (2026-11-12).
   */
  async function submitHh(letter) {
    // 1. Открываем форму отклика — кликаем по кнопке "Откликнуться"
    const responseBtn = document.querySelector(
      'a[data-qa="vacancy-response-link-top"], ' +
      'a[data-qa="vacancy-response-link"], ' +
      'button[data-qa="vacancy-response-link-top"], ' +
      'button[data-qa="vacancy-response-link"], ' +
      'span[data-qa="vacancy-response-link"]'
    );
    if (!responseBtn) {
      return { ok: false, code: 'NO_RESPONSE_BUTTON', message: 'Не найдена кнопка отклика на странице вакансии hh.ru' };
    }
    responseBtn.click();

    // Ждём появления попапа
    await waitForElement('div[data-qa="vacancy-response-popup"], .vacancy-response-popup', 5000);

    // 2. Выбираем резюме (первое доступное)
    const resumeSelect = document.querySelector(
      'select[data-qa="vacancy-response-popup-form-resume-select"], ' +
      'select.bloko-select'
    );
    if (resumeSelect && resumeSelect.options.length > 0) {
      resumeSelect.selectedIndex = 0;
      resumeSelect.dispatchEvent(new Event('change', { bubbles: true }));
      await sleep(500);
    }

    // 3. Заполняем сопроводительное письмо
    // hh.ru: если есть переключатель письма — включаем, затем заполняем textarea
    const toggle = document.querySelector('[data-qa="vacancy-response-letter-toggle"]');
    if (toggle) {
      toggle.click();
      await sleep(300);
    }

    const letterArea = document.querySelector(
      'textarea[data-qa="vacancy-response-popup-form-letter-input"], ' +
      'textarea[name*="letter"], ' +
      'textarea.bloko-textarea'
    );
    if (letterArea) {
      letterArea.value = letter;
      letterArea.dispatchEvent(new Event('input', { bubbles: true }));
      letterArea.dispatchEvent(new Event('change', { bubbles: true }));
      await sleep(200);
    } else {
      // Если textarea не найдена, но письмо обязательно — ошибка
      const helper = document.body.innerText;
      if (/Сопроводительное письмо обязательно/i.test(helper)) {
        return { ok: false, code: 'NO_LETTER_FIELD', message: 'Сайт требует сопроводительное письмо, но поле не найдено' };
      }
    }

    // 4. Отвечаем на вопросы работодателя (если есть)
    const questions = document.querySelectorAll('[data-qa="task-body"]');
    for (const q of questions) {
      // Текстовые вопросы
      const textarea = q.querySelector('textarea');
      if (textarea) {
        textarea.value = '—';
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        continue;
      }
      // Выбор одного варианта — выбираем первый
      const radio = q.querySelector('input[type="radio"]');
      if (radio && !radio.checked) {
        radio.click();
        await sleep(100);
        continue;
      }
      // Чекбоксы — отмечаем первый
      const checkbox = q.querySelector('input[type="checkbox"]');
      if (checkbox && !checkbox.checked) {
        checkbox.click();
        await sleep(100);
      }
    }

    // 5. Отправляем
    const submitBtn = document.querySelector(
      'button[data-qa="vacancy-response-submit-popup"], ' +
      'button[data-qa="vacancy-response-submit"], ' +
      'button.vacancy-response__submit'
    );
    if (!submitBtn) {
      return { ok: false, code: 'NO_SUBMIT_BUTTON', message: 'Не найдена кнопка отправки отклика' };
    }

    // Проверяем, не заблокирована ли кнопка
    if (submitBtn.disabled || submitBtn.getAttribute('aria-disabled') === 'true') {
      return { ok: false, code: 'SUBMIT_DISABLED', message: 'Кнопка отправки отклика заблокирована (возможно, не выбран вопрос)' };
    }

    submitBtn.click();

    // Ждём подтверждения
    const confirmed = await waitForElement(
      '[data-qa="vacancy-response-success"], .vacancy-response__success, ' +
      '[data-qa="vacancy-response-popup-success"]', 8000
    );

    return {
      ok: true,
      code: 'SUBMITTED',
      message: 'Отклик на hh.ru отправлен',
      confirmed: !!confirmed,
      site: 'hh.ru'
    };
  }

  /**
   * Заполняет форму отклика на LinkedIn.
   * LinkedIn использует SPA-интерфейс с модальным окном отклика.
   */
  async function submitLinkedin(letter) {
    // Ищем кнопку "Easy Apply" или "Apply"
    const applyBtn = findButton([
      'button[data-control-name="jobdetails_easyapply"]',
      'button[data-job-id] .jobs-apply-button',
      'button.jobs-apply-button',
      'button:has(span:contains("Apply"))',
      'button:has(span:contains("Easy Apply"))'
    ]);
    if (!applyBtn) {
      return { ok: false, code: 'NO_APPLY_BUTTON', message: 'Не найдена кнопка отклика на LinkedIn' };
    }
    applyBtn.click();
    await sleep(1500);

    // Проходим шаги формы Easy Apply
    for (let step = 0; step < 10; step++) {
      // Ищем поле сопроводительного письма
      const letterField = document.querySelector(
        'textarea[id*="cover-letter"], ' +
        'textarea[data-test-text-entity-list-form-component]'
      );
      if (letterField) {
        letterField.value = letter;
        letterField.dispatchEvent(new Event('input', { bubbles: true }));
      }

      // Заполняем текстовые поля
      const textInputs = document.querySelectorAll(
        'input[data-test-text-entity-list-form-component], ' +
        'textarea[data-test-text-entity-list-form-component]'
      );
      for (const input of textInputs) {
        if (!input.value.trim()) {
          input.value = input.placeholder || '—';
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }

      // Выбираем первый вариант в select
      const selects = document.querySelectorAll('select[data-test-text-entity-list-form-component]');
      for (const sel of selects) {
        if (sel.selectedIndex === 0 && sel.options.length > 1) {
          sel.selectedIndex = 1;
          sel.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }

      // Нажимаем "Next" или "Review" или "Submit"
      const nextBtn = findButton([
        'button[aria-label="Next"]',
        'button[aria-label="Review"]',
        'button[aria-label="Submit application"]',
        'button:has(span:contains("Next"))',
        'button:has(span:contains("Submit"))',
        'button:has(span:contains("Review"))',
        '.artdeco-button--primary'
      ]);
      if (!nextBtn) break;
      if (nextBtn.disabled) {
        await sleep(500);
        continue;
      }
      nextBtn.click();
      await sleep(1000);

      // Если кнопка исчезла — значит, форма закрыта (успех)
      const stillOpen = document.querySelector(
        '.easy-apply-modal, [data-test-modal-id="easy-apply"]'
      );
      if (!stillOpen) {
        return { ok: true, code: 'SUBMITTED', message: 'Отклик на LinkedIn отправлен', site: 'linkedin' };
      }
    }

    // Проверяем, не осталось ли модальное окно с подтверждением
    const dismissBtn = findButton([
      'button[aria-label="Dismiss"]',
      'button:has(span:contains("Done"))',
      'button:has(span:contains("Close"))'
    ]);
    if (dismissBtn) dismissBtn.click();

    return { ok: true, code: 'SUBMITTED', message: 'Отклик на LinkedIn отправлен', site: 'linkedin' };
  }

  /**
   * Заполняет форму отклика на Upwork.
   * Upwork использует модальное окно "Submit a Proposal".
   */
  async function submitUpwork(letter) {
    // Ищем кнопку "Submit a Proposal" или "Apply Now"
    const applyBtn = findButton([
      'button[data-test="submit-proposal-button"]',
      'button:has(span:contains("Submit a Proposal"))',
      'button:has(span:contains("Apply Now"))',
      'a:has(span:contains("Submit a Proposal"))',
      'a:has(span:contains("Apply Now"))'
    ]);
    if (!applyBtn) {
      return { ok: false, code: 'NO_APPLY_BUTTON', message: 'Не найдена кнопка отклика на Upwork' };
    }
    applyBtn.click();
    await sleep(2000);

    // Заполняем сопроводительное письмо
    const letterField = document.querySelector(
      'textarea[data-test="cover-letter"], ' +
      'div[data-test="cover-letter"] [contenteditable="true"], ' +
      'div.editor [contenteditable="true"], ' +
      'textarea.proposal-form'
    );
    if (letterField) {
      if (letterField.tagName === 'TEXTAREA') {
        letterField.value = letter;
        letterField.dispatchEvent(new Event('input', { bubbles: true }));
      } else {
        // contenteditable div
        letterField.textContent = letter;
        letterField.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }

    await sleep(500);

    // Заполняем ставку (если есть поле) — минимальную
    const rateInput = document.querySelector(
      'input[data-test="bid-amount"], ' +
      'input[name*="rate"], ' +
      'input[name*="bid"]'
    );
    if (rateInput && !rateInput.value.trim()) {
      rateInput.value = '10';
      rateInput.dispatchEvent(new Event('input', { bubbles: true }));
    }

    // Отвечаем на вопросы
    const questionInputs = document.querySelectorAll(
      '.question-item input, .question-item textarea'
    );
    for (const input of questionInputs) {
      if (!input.value.trim()) {
        input.value = '—';
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }

    // Отправляем
    const submitBtn = findButton([
      'button[data-test="submit-proposal"]',
      'button:has(span:contains("Send Proposal"))',
      'button:has(span:contains("Submit"))',
      'button.proposal-submit'
    ]);
    if (!submitBtn) {
      return { ok: false, code: 'NO_SUBMIT_BUTTON', message: 'Не найдена кнопка отправки предложения на Upwork' };
    }
    submitBtn.click();

    await sleep(2000);

    return { ok: true, code: 'SUBMITTED', message: 'Предложение на Upwork отправлено', site: 'upwork' };
  }

  // ---------- утилиты ----------

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function waitForElement(selector, timeout) {
    return new Promise((resolve) => {
      const el = document.querySelector(selector);
      if (el) { resolve(el); return; }
      const observer = new MutationObserver(() => {
        const found = document.querySelector(selector);
        if (found) {
          observer.disconnect();
          resolve(found);
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
      if (timeout) {
        setTimeout(() => {
          observer.disconnect();
          resolve(null);
        }, timeout);
      }
    });
  }

  function findButton(selectors) {
    for (const s of selectors) {
      try {
        const el = document.querySelector(s);
        if (el) return el;
      } catch (_) { /* ignore bad selector */ }
    }
    // Fallback: ищем кнопку по тексту
    const buttons = document.querySelectorAll('button, a');
    for (const btn of buttons) {
      const text = (btn.innerText || '').trim().toLowerCase();
      for (const s of selectors) {
        const keyword = s.replace(/.*contains\(['"](.+)['"]\).*/, '$1').toLowerCase();
        if (keyword && text.includes(keyword)) return btn;
      }
    }
    return null;
  }

  // ---------- обработчик сообщений ----------

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'FILL_AND_SUBMIT') {
      const site = detectSite(location.href);
      if (!site) {
        sendResponse({ ok: false, code: 'UNSUPPORTED_SITE', message: 'Сайт не поддерживается для автоматического отклика' });
        return;
      }

      const letter = msg.letter || '';

      let promise;
      switch (site) {
        case 'hh':
          promise = submitHh(letter);
          break;
        case 'linkedin':
          promise = submitLinkedin(letter);
          break;
        case 'upwork':
          promise = submitUpwork(letter);
          break;
        default:
          sendResponse({ ok: false, code: 'UNSUPPORTED_SITE', message: 'Сайт не поддерживается' });
          return;
      }

      promise.then(sendResponse).catch(err => {
        sendResponse({ ok: false, code: 'SUBMIT_ERROR', message: String(err.message || err) });
      });

      return true; // keep channel open for async response
    }
  });
})();
