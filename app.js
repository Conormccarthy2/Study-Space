(() => {
  "use strict";

  const remindersKey = "reminders-app-items";
  const workCompletionPrefix = "dayplan-work-completion:";
  const byId = (id) => document.getElementById(id);

  window.addEventListener("pageshow", (event) => {
    if (event.persisted) window.location.reload();
  });

  function readStorage(key, fallback, storageName = "localStorage") {
    try {
      return JSON.parse(window[storageName].getItem(key)) ?? fallback;
    } catch {
      return fallback;
    }
  }

  function writeStorage(key, value, storageName = "localStorage") {
    try {
      window[storageName].setItem(key, JSON.stringify(value));
    } catch {}
  }

  function removeButton(name, remove) {
    const button = document.createElement("button");
    button.className = "remove";
    button.type = "button";
    button.textContent = "Delete";
    button.setAttribute("aria-label", `Delete ${name}`);
    button.addEventListener("click", remove);
    return button;
  }

  const pomodoroKey = "dayplan-pomodoro";
  const historyPrefix = "dayplan-session-history:";

  function readPomodoro() {
    const saved = readStorage(pomodoroKey, {}, "sessionStorage");
    const durations = saved.durations ?? { work: 20, short: 3, long: 5 };
    const deadline = saved.deadline ?? null;
    return {
      durations,
      session: saved.session ?? "work",
      completed: saved.completed ?? 0,
      remaining: saved.remaining ?? durations.work * 60_000,
      deadline,
      runId: saved.runId ?? (deadline === null ? null : `legacy-${deadline}`),
      history: saved.history ?? null,
    };
  }

  function savePomodoro(state) {
    writeStorage(pomodoroKey, state, "sessionStorage");
    if (state.history) {
      writeStorage(historyPrefix + state.history.id, state.history);
    }
  }

  function advancePomodoro(state, now) {
    if (state.deadline === null) return false;
    let sessionChanged = false;

    function addFocus(until) {
      const history = state.history;
      if (!history || until <= history.accountedAt) return;
      if (state.session === "work") {
        history.focusMs += until - history.accountedAt;
      }
      history.accountedAt = until;
    }

    while (state.deadline <= now) {
      addFocus(state.deadline);
      if (state.session === "work") {
        state.completed += 1;
        if (state.history) state.history.workSessions += 1;
        writeStorage(
          `${workCompletionPrefix}${state.deadline}:${state.runId}`,
          state.durations.work,
        );
        state.session = state.completed % 4 === 0 ? "long" : "short";
      } else {
        state.session = "work";
      }
      state.deadline += state.durations[state.session] * 60_000;
      sessionChanged = true;
    }

    addFocus(now);
    state.remaining = state.deadline - now;
    return sessionChanged;
  }

  function initPomodoro() {
    const labels = {
      work: "Work session",
      short: "Short break",
      long: "Long break",
    };
    const state = readPomodoro();
    let timerId;

    const timer = byId("timer");
    const start = byId("start");
    const pause = byId("pause");
    const dialog = byId("settings-dialog");
    const form = byId("settings-form");

    function render() {
      const totalSeconds = Math.ceil(state.remaining / 1000);
      const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
      const seconds = String(totalSeconds % 60).padStart(2, "0");
      timer.textContent = minutes + ":" + seconds;
      const running = state.deadline !== null;
      start.textContent = state.history ? "Resume" : "Start";
      byId("timer-status").textContent = running
        ? "Running"
        : state.history
          ? "Paused"
          : "Ready to start";
      start.hidden = running;
      pause.hidden = !running;
    }

    function renderCycle() {
      byId("session").textContent = labels[state.session];
      byId("completed-sessions").textContent = state.completed;
      for (const [name, minutes] of Object.entries(state.durations)) {
        byId(name + "-duration").textContent = `${minutes} min`;
      }
    }

    function updateTimer() {
      if (advancePomodoro(state, Date.now())) {
        renderCycle();
        savePomodoro(state);
      }
      render();
    }

    function stop(endRun) {
      updateTimer();
      clearInterval(timerId);
      state.deadline = null;
      if (endRun && state.history) {
        writeStorage(historyPrefix + state.history.id, state.history);
        state.history = null;
      }
    }

    start.addEventListener("click", () => {
      if (state.deadline !== null) return;
      const now = Date.now();
      state.runId =
        crypto.randomUUID?.() ??
        Array.from(crypto.getRandomValues(new Uint32Array(4))).join("-");
      state.history ??= {
        id: state.runId,
        startedAt: now,
        workSessions: 0,
        focusMs: 0,
      };
      state.history.accountedAt = now;
      state.deadline = now + state.remaining;
      timerId = setInterval(updateTimer, 200);
      savePomodoro(state);
      render();
      pause.focus();
    });

    pause.addEventListener("click", () => {
      stop(false);
      savePomodoro(state);
      render();
      start.focus();
    });

    byId("reset").addEventListener("click", () => {
      stop(true);
      state.session = "work";
      state.completed = 0;
      state.remaining = state.durations.work * 60_000;
      savePomodoro(state);
      renderCycle();
      render();
    });

    byId("settings-button").addEventListener("click", () => {
      for (const [name, minutes] of Object.entries(state.durations)) {
        form.elements.namedItem(name).value = minutes;
      }
      dialog.showModal();
    });

    byId("close-settings").addEventListener("click", () => dialog.close());
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      stop(true);
      const values = new FormData(form);
      state.durations = {
        work: Number(values.get("work")),
        short: Number(values.get("short")),
        long: Number(values.get("long")),
      };
      state.remaining = state.durations[state.session] * 60_000;
      savePomodoro(state);
      renderCycle();
      render();
      dialog.close();
    });

    window.addEventListener("pagehide", () => {
      if (state.deadline === null) return;
      advancePomodoro(state, Date.now());
      savePomodoro(state);
    });

    renderCycle();
    render();
    if (state.deadline !== null) {
      updateTimer();
      timerId = setInterval(updateTimer, 200);
    }
  }

  function currentWeekBounds() {
    const weekStart = new Date();
    weekStart.setHours(0, 0, 0, 0);
    weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));

    const nextWeekStart = new Date(weekStart);
    nextWeekStart.setDate(nextWeekStart.getDate() + 7);

    return [weekStart.getTime(), nextWeekStart.getTime()];
  }

  function countTasksCompletedThisWeek(tasks) {
    if (!Array.isArray(tasks)) return 0;
    const [weekStart, nextWeekStart] = currentWeekBounds();
    return tasks.filter(
      (task) =>
        task?.completed &&
        Number.isFinite(task.completedAt) &&
        task.completedAt >= weekStart &&
        task.completedAt < nextWeekStart,
    ).length;
  }

  function initTasks() {
    const key = "todo-tasks";
    const saved = readStorage(key, []);
    const tasks = Array.isArray(saved)
      ? saved.filter((task) => typeof task?.text === "string")
      : [];
    const list = byId("task-list");
    const input = byId("task-input");

    function updateSummary() {
      const completed = tasks.filter((task) => task.completed).length;
      const tasksCompletedThisWeek = countTasksCompletedThisWeek(tasks);
      byId("task-count").textContent =
        `${completed} of ${tasks.length} done · ${tasksCompletedThisWeek} this week`;
      byId("task-empty").hidden = tasks.length > 0;
    }

    function appendTask(task) {
      const row = document.createElement("li");
      row.className = "list-row";
      const label = document.createElement("label");
      label.className = "task-label";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = Boolean(task.completed);
      const text = document.createElement("span");
      text.textContent = task.text;
      label.append(checkbox, text);

      checkbox.addEventListener("change", () => {
        task.completed = checkbox.checked;
        task.completedAt = checkbox.checked ? Date.now() : null;
        writeStorage(key, tasks);
        updateSummary();
      });

      const remove = removeButton(task.text, () => {
        const next = row.nextElementSibling ?? row.previousElementSibling;
        tasks.splice(tasks.indexOf(task), 1);
        row.remove();
        writeStorage(key, tasks);
        updateSummary();
        (next?.querySelector(".remove") ?? input).focus();
      });

      row.append(label, remove);
      list.append(row);
    }

    byId("task-form").addEventListener("submit", (event) => {
      event.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      const task = { text, completed: false };
      tasks.push(task);
      appendTask(task);
      writeStorage(key, tasks);
      updateSummary();
      event.currentTarget.reset();
      input.focus();
    });

    tasks.forEach(appendTask);
    updateSummary();
    setInterval(updateSummary, 60_000);
  }

  function readReminders() {
    const saved = readStorage(remindersKey, []);
    return Array.isArray(saved)
      ? saved.filter(
          (item) =>
            typeof item?.name === "string" &&
            /^\d{4,}-\d{2}-\d{2}$/.test(item.date) &&
            Number.isFinite(Date.parse(item.date)),
        )
      : [];
  }

  function localCalendarDay(now) {
    return Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  }

  function initReminders() {
    const reminders = readReminders();
    const list = byId("reminder-list");
    const input = byId("reminder-name");
    const displayDate = new Intl.DateTimeFormat("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    });

    function render() {
      const now = new Date();
      byId("today").textContent = now.toLocaleDateString("en-GB", {
        weekday: "long",
        month: "long",
        day: "numeric",
      });
      const today = localCalendarDay(now);
      list.replaceChildren();

      const sorted = [...reminders].sort(
        (a, b) => Date.parse(a.date) - Date.parse(b.date),
      );
      sorted.forEach((reminder, index) => {
        const date = Date.parse(reminder.date);
        const days = (date - today) / 86_400_000;

        const row = document.createElement("li");
        row.className = "list-row";
        const details = document.createElement("div");
        const name = document.createElement("p");
        name.className = "reminder-name";
        name.textContent = reminder.name;
        const meta = document.createElement("div");
        meta.className = "reminder-meta";
        const time = document.createElement("time");
        time.dateTime = reminder.date;
        time.textContent = displayDate.format(date);
        const status = document.createElement("span");
        status.className = "due-status";
        if (days < 0) {
          status.classList.add("overdue");
          status.textContent = "Overdue";
        } else if (days <= 7) {
          status.classList.add("soon");
          status.textContent = days === 0 ? "Due today" : "Due this week";
        } else if (days <= 30) {
          status.classList.add("month");
          status.textContent = "Due within 30 days";
        } else {
          status.textContent = "Later";
        }

        meta.append(time, status);
        details.append(name, meta);
        row.append(
          details,
          removeButton(reminder.name, () => {
            reminders.splice(reminders.indexOf(reminder), 1);
            writeStorage(remindersKey, reminders);
            render();
            const next =
              list.children[Math.min(index, list.children.length - 1)];
            (next?.querySelector(".remove") ?? input).focus();
          }),
        );
        list.append(row);
      });

      const count = reminders.length;
      byId("reminder-count").textContent =
        `${count} ${count === 1 ? "reminder" : "reminders"}`;
      byId("reminder-empty").hidden = count > 0;
    }

    byId("reminder-form").addEventListener("submit", (event) => {
      event.preventDefault();
      const name = input.value.trim();
      const date = byId("reminder-date").value;
      if (!name || !Number.isFinite(Date.parse(date))) return;
      const id =
        crypto.randomUUID?.() ??
        Array.from(crypto.getRandomValues(new Uint32Array(4))).join("-");
      reminders.push({ id, name, date });
      writeStorage(remindersKey, reminders);
      render();
      event.currentTarget.reset();
      input.focus();
    });

    render();
  }

  function readWeeklyWorkStats() {
    const [weekStart, nextWeekStart] = currentWeekBounds();
    let completed = 0;
    let totalFocusMinutes = 0;

    try {
      const storage = window.localStorage;
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        if (!key?.startsWith(workCompletionPrefix)) continue;

        const timestamp = Number(
          key.slice(workCompletionPrefix.length).split(":")[0],
        );
        if (!(timestamp >= weekStart && timestamp < nextWeekStart)) continue;

        const minutes = readStorage(key, null);
        if (!Number.isFinite(minutes) || minutes <= 0) continue;
        completed += 1;
        totalFocusMinutes += minutes;
      }
    } catch {}

    return { completed, totalFocusMinutes };
  }

  function initDashboardStats() {
    const sessions = byId("stat-work-sessions");
    const focusMinutes = byId("stat-focus-minutes");
    const weeklyTasks = byId("stat-weekly-tasks");
    const upcomingReminders = byId("stat-upcoming-reminders");
    if (!sessions && !focusMinutes && !weeklyTasks && !upcomingReminders) return;

    function render() {
      if (sessions || focusMinutes) {
        const stats = readWeeklyWorkStats();
        if (sessions) sessions.textContent = stats.completed;
        if (focusMinutes) focusMinutes.textContent = stats.totalFocusMinutes;
      }
      if (weeklyTasks) {
        weeklyTasks.textContent = countTasksCompletedThisWeek(
          readStorage("todo-tasks", []),
        );
      }
      if (upcomingReminders) {
        const today = localCalendarDay(new Date());
        const lastDay = today + 7 * 86_400_000;
        upcomingReminders.textContent = readReminders().filter((reminder) => {
          const due = Date.parse(reminder.date);
          return due >= today && due <= lastDay;
        }).length;
      }
    }

    render();
    window.addEventListener("storage", (event) => {
      if (
        event.key === null ||
        event.key === "todo-tasks" ||
        event.key === remindersKey ||
        event.key.startsWith(workCompletionPrefix)
      ) {
        render();
      }
    });
    setInterval(render, 60_000);
  }

  function readSessionHistory() {
    const runs = [];
    try {
      const storage = window.localStorage;
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        if (!key?.startsWith(historyPrefix)) continue;
        const run = readStorage(key, null);
        if (Number.isFinite(run?.startedAt)) runs.push(run);
      }
    } catch {}
    return runs.sort((a, b) => b.startedAt - a.startedAt);
  }

  function formatFocusTime(focusMs) {
    const seconds = Math.floor(focusMs / 1000);
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor(seconds / 60) % 60;
    const parts = [];
    if (hours) parts.push(`${hours} hr`);
    if (minutes) parts.push(`${minutes} min`);
    if (seconds % 60 || parts.length === 0) parts.push(`${seconds % 60} sec`);
    return parts.join(" ");
  }

  function initSessionHistory() {
    const list = byId("history-list");
    const empty = byId("history-empty");
    const state = readPomodoro();
    const dateFormat = new Intl.DateTimeFormat("en-GB", {
      dateStyle: "medium",
      timeStyle: "short",
    });

    function render() {
      if (advancePomodoro(state, Date.now())) savePomodoro(state);
      const runs = readSessionHistory();
      if (state.history) {
        const index = runs.findIndex((run) => run.id === state.history.id);
        if (index >= 0) runs[index] = state.history;
        else runs.unshift(state.history);
      }

      list.replaceChildren();
      for (const run of runs) {
        const row = document.createElement("li");
        row.className = "list-row";
        const time = document.createElement("time");
        time.dateTime = new Date(run.startedAt).toISOString();
        time.textContent = dateFormat.format(run.startedAt);
        const totals = document.createElement("span");
        const label = run.workSessions === 1 ? "work block" : "work blocks";
        totals.textContent =
          `${run.workSessions} ${label} completed · ${formatFocusTime(run.focusMs)} focused`;
        row.append(time, totals);
        list.append(row);
      }
      empty.hidden = runs.length > 0;
    }

    render();
    if (state.deadline !== null) {
      setInterval(render, 1000);
      window.addEventListener("pagehide", () => {
        advancePomodoro(state, Date.now());
        savePomodoro(state);
      });
    }
    window.addEventListener("storage", (event) => {
      if (event.key === null || event.key.startsWith(historyPrefix)) render();
    });
  }

  const pages = {
    pomodoro: initPomodoro,
    todo: initTasks,
    reminders: initReminders,
    history: initSessionHistory,
  };
  pages[document.body.dataset.page]?.();
  initDashboardStats();
})();

//navbar//
(() => {
  const toggle = document.querySelector(".menu #toggle");
  const links = document.querySelector(".menu #links");
  if (!toggle || !links) return;

  const pages = links.querySelectorAll("a");
  pages.forEach((page, index) => {
    const angle = -180 + index * 180 / (pages.length - 1);
    page.style.setProperty("--desktop-angle", angle + "deg");
    page.style.setProperty("--mobile-angle", (-180 + (index % 5) * 45) + "deg");
  });

  function setOpen(open) {
    links.inert = !open;
    toggle.textContent = open ? "×" : "+";
    toggle.setAttribute("aria-expanded", String(open));
  }

  toggle.addEventListener("click", () => setOpen(links.inert));
  links.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      setOpen(false);
      toggle.focus();
    }
  });
})();
