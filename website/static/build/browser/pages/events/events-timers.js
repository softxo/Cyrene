// @ts-nocheck -- Legacy global script; types will be tightened incrementally.
// =========================================================
// EVENTS — COUNTDOWN TIMERS
// =========================================================
window.updateEventTimeLeft = function updateEventTimeLeft() {
    function formatCountdown(remaining) {
        const days = Math.floor(remaining / 86400);
        const hours = Math.floor((remaining % 86400) / 3600);
        const minutes = Math.floor((remaining % 3600) / 60);
        if (days > 0) {
            return `${days}d ${hours}h ${minutes}m`;
        }
        if (hours > 0) {
            return `${hours}h ${minutes}m`;
        }
        return `${minutes}m`;
    }
    function updateDailyUrgency(timer, remaining) {
        timer.classList.toggle("danger", remaining > 0 && remaining <= 4 * 3600);
        timer.classList.toggle("warning", remaining > 4 * 3600 && remaining <= 10 * 3600);
    }
    const timers = document.querySelectorAll(".event-time-left[data-end-time], [data-daily-event-reset][data-end-time]");
    const now = Math.floor(Date.now() / 1000);
    timers.forEach((timer) => {
        if (timer.dataset.limitedComplete === "true")
            return;
        const endTime = Number(timer.dataset.endTime);
        const startTime = Number(timer.dataset.startTime);
        if (!endTime) {
            return;
        }
        if (startTime && startTime > now) {
            timer.textContent = `Starts in ${formatCountdown(startTime - now)}`;
            timer.classList.add("upcoming");
            timer.classList.remove("expired", "warning", "danger");
            return;
        }
        timer.classList.remove("upcoming");
        const eventItem = timer.closest(".event-limited-item");
        eventItem?.classList.remove("upcoming");
        eventItem?.querySelector(".event-limited-upcoming-label")?.remove();
        const originalRemaining = endTime - now;
        if (timer.hasAttribute("data-daily-event-reset")) {
            const eventEnd = Number(timer.dataset.eventEndTime);
            timer.classList.remove("warning", "danger", "expired");
            if (eventEnd && eventEnd <= now) {
                timer.textContent = "Ended";
            }
            else if (originalRemaining <= 0) {
                timer.textContent = "Resetting...";
                // Refresh completion identity as well as the timer at the daily boundary.
                if (now >= Number(timer.dataset.nextResetRefresh || 0)) {
                    timer.dataset.nextResetRefresh = String(now + 60);
                    window.refreshEvents?.();
                }
            }
            else {
                timer.textContent = formatCountdown(originalRemaining);
                updateDailyUrgency(timer, originalRemaining);
            }
            return;
        }
        // -----------------------------------------
        // EXPIRED
        // -----------------------------------------
        if (originalRemaining <= 0) {
            timer.textContent = timer.classList.contains("stygian-reset-timer")
                ? "Resetting..."
                : "Updating...";
            timer.classList.add("expired");
            timer.classList.remove("warning", "danger");
            return;
        }
        // -----------------------------------------
        // ACTIVE
        // -----------------------------------------
        timer.classList.remove("expired");
        timer.textContent = formatCountdown(originalRemaining);
        // -----------------------------------------
        // TIME STATUS
        // -----------------------------------------
        timer.classList.remove("warning", "danger");
        if (timer.classList.contains("event-daily-reset")) {
            updateDailyUrgency(timer, originalRemaining);
        }
        else if (timer.dataset.countdownKind === "long-event") {
            if (originalRemaining <= 3 * 86400) {
                timer.classList.add("danger");
            }
            else if (originalRemaining <= 7 * 86400) {
                timer.classList.add("warning");
            }
            // Other limited event expiry timers keep their existing thresholds.
        }
        else if (originalRemaining < 86400) {
            timer.classList.add("danger");
            // Less than 3 days remaining.
        }
        else if (originalRemaining < 259200) {
            timer.classList.add("warning");
        }
    });
    // =====================================================
    // OVERVIEW — RESIN COUNTDOWNS
    // =====================================================
    document.querySelectorAll(".overview-resin-timer[data-resin-timestamp]").forEach((timer) => {
        let timestamp = Number(timer.dataset.resinTimestamp);
        const currentTime = Math.floor(Date.now() / 1000);
        // -----------------------------------------
        // FULL RESIN
        // -----------------------------------------
        if (!timestamp) {
            timer.textContent = "Full";
            return;
        }
        // -----------------------------------------
        // NEXT RESIN
        // -----------------------------------------
        if (timer.dataset.resinKind === "next" && timestamp <= currentTime) {
            // Each Resin takes 8 minutes.
            while (timestamp <= currentTime) {
                timestamp += 480;
            }
            timer.dataset.resinTimestamp = String(timestamp);
        }
        const remaining = Math.max(0, timestamp - currentTime);
        const hours = Math.floor(remaining / 3600);
        const minutes = Math.floor((remaining % 3600) / 60);
        const seconds = remaining % 60;
        if (hours > 0) {
            timer.textContent = `${hours}h ${minutes}m`;
        }
        else if (minutes > 0) {
            timer.textContent = `${minutes}m ${seconds}s`;
        }
        else {
            timer.textContent = `${seconds}s`;
        }
    });
};
