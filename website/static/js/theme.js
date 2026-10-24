function updateThemeSelection(theme) {
    document
        .querySelectorAll("[data-theme-option]")
        .forEach(option => {
            option.classList.toggle(
                "selected",
                option.dataset.themeOption === theme
            );
        });
}


function setTheme(theme) {
    document.documentElement.dataset.theme = theme;

    localStorage.setItem("theme", theme);

    updateThemeSelection(theme);
}


document.addEventListener("DOMContentLoaded", () => {
    updateThemeSelection(
        document.documentElement.dataset.theme
    );
});