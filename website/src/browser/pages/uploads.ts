interface UploadedFile {
    id: string;
    filename: string;
    kind: string;
    size_label: string;
    created_label: string;
    page_url: string;
    status: "processing" | "ready" | "failed";
}

interface VideoDetails {
    width: number;
    height: number;
    thumbnail: Blob | null;
}

interface Window {
    initUploads?: () => void;
}

(() => {
    const THUMBNAIL_WIDTH = 1280;
    const STATUS_POLL_MS = 5000;
    const STATUS_TEXT = {
        processing: "Converting for Discord…",
        ready: "",
        failed: "Couldn't convert; the original file is kept.",
    };

    function notify(message: string, kind: "success" | "warning" | "error" = "success"): void {
        window.showCyreneToast?.(message, kind);
    }

    async function errorMessage(response: Response): Promise<string> {
        try {
            const body: unknown = await response.json();
            if (body && typeof body === "object" && "detail" in body) {
                return String(body.detail);
            }
        } catch {
            return `Request failed (${response.status}).`;
        }
        return `Request failed (${response.status}).`;
    }

    function readVideo(file: File): Promise<VideoDetails | null> {
        return new Promise((resolve) => {
            const video = document.createElement("video");
            const source = URL.createObjectURL(file);
            const finish = (details: VideoDetails | null): void => {
                URL.revokeObjectURL(source);
                resolve(details);
            };
            video.muted = true;
            video.preload = "auto";
            video.addEventListener("error", () => finish(null), { once: true });
            video.addEventListener(
                "loadedmetadata",
                () => {
                    video.currentTime = Math.min(1, video.duration / 4 || 0);
                },
                { once: true },
            );
            video.addEventListener(
                "seeked",
                () => {
                    const { videoWidth: width, videoHeight: height } = video;
                    if (!width || !height) {
                        finish(null);
                        return;
                    }
                    const scale = Math.min(1, THUMBNAIL_WIDTH / width);
                    const canvas = document.createElement("canvas");
                    canvas.width = Math.round(width * scale);
                    canvas.height = Math.round(height * scale);
                    canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
                    canvas.toBlob(
                        (thumbnail) => finish({ width, height, thumbnail }),
                        "image/jpeg",
                        0.85,
                    );
                },
                { once: true },
            );
            video.src = source;
        });
    }

    function send(
        file: File,
        video: VideoDetails | null,
        onProgress: (fraction: number) => void,
    ): Promise<Response> {
        return new Promise((resolve, reject) => {
            const request = new XMLHttpRequest();
            request.open("POST", "/api/uploads");
            request.setRequestHeader("Content-Type", file.type || "application/octet-stream");
            request.setRequestHeader("X-Upload-Name", encodeURIComponent(file.name));
            if (video) {
                request.setRequestHeader("X-Video-Width", String(video.width));
                request.setRequestHeader("X-Video-Height", String(video.height));
            }
            request.upload.addEventListener("progress", (event) => {
                if (event.lengthComputable) onProgress(event.loaded / event.total);
            });
            request.addEventListener("load", () =>
                resolve(
                    new Response(request.responseText || null, {
                        status: request.status,
                        headers: { "Content-Type": "application/json" },
                    }),
                ),
            );
            request.addEventListener("error", () => reject(new Error("Network error")));
            request.addEventListener("abort", () => reject(new Error("Upload cancelled")));
            request.send(file);
        });
    }

    function initUploads(): void {
        const page = document.querySelector<HTMLElement>(".uploads-page:not(.uploads-view)");
        if (!page || page.dataset.initialised === "true") return;
        page.dataset.initialised = "true";

        const drop = page.querySelector<HTMLElement>("[data-upload-drop]");
        const input = page.querySelector<HTMLInputElement>("[data-upload-input]");
        const list = page.querySelector<HTMLUListElement>("[data-upload-list]");
        const empty = page.querySelector<HTMLElement>("[data-upload-empty]");
        const template = page.querySelector<HTMLTemplateElement>("[data-upload-template]");
        const progress = page.querySelector<HTMLElement>("[data-upload-progress]");
        const progressName = page.querySelector<HTMLElement>("[data-upload-progress-name]");
        const progressValue = page.querySelector<HTMLElement>("[data-upload-progress-value]");
        const progressBar = page.querySelector<HTMLProgressElement>("[data-upload-progress-bar]");
        const confirmation = document.querySelector<HTMLDialogElement>(".uploads-delete-dialog");
        const confirmButton =
            confirmation?.querySelector<HTMLButtonElement>("[data-delete-confirm]");
        const cancelButton = confirmation?.querySelector<HTMLButtonElement>("[data-delete-cancel]");
        const description = confirmation?.querySelector<HTMLElement>("[data-delete-description]");
        let pendingDelete: { row: HTMLElement; button: HTMLButtonElement } | null = null;
        if (
            !confirmation ||
            !confirmButton ||
            !cancelButton ||
            !drop ||
            !input ||
            !list ||
            !empty ||
            !template ||
            !progress ||
            !progressName ||
            !progressValue ||
            !progressBar
        ) {
            return;
        }

        const setProgress = (fraction: number): void => {
            const percent = Math.round(fraction * 100);
            progressBar.value = percent;
            progressValue.textContent = `${percent}%`;
        };
        const fillRow = (row: HTMLElement, upload: UploadedFile): void => {
            row.dataset.uploadId = upload.id;
            row.querySelector("[data-kind]")?.setAttribute("data-kind", upload.kind);
            const name = row.querySelector<HTMLAnchorElement>("[data-upload-name]");
            if (name) {
                name.href = `/f/${upload.id}`;
                name.textContent = upload.filename;
            }
            const meta = row.querySelector("[data-upload-meta]");
            if (meta) meta.textContent = `${upload.size_label} · ${upload.created_label} UTC`;
            const status = row.querySelector<HTMLElement>("[data-upload-status]");
            if (status) {
                status.dataset.uploadStatus = upload.status;
                status.textContent = STATUS_TEXT[upload.status];
            }
            row.querySelector("[data-upload-copy]")?.setAttribute(
                "data-upload-copy",
                upload.page_url,
            );
            row.querySelector("[data-upload-delete]")?.setAttribute(
                "aria-label",
                `Delete ${upload.filename}`,
            );
        };
        const watchConversion = (row: HTMLElement): void => {
            const check = async (): Promise<void> => {
                if (!row.isConnected || !row.dataset.uploadId) return;
                try {
                    const response = await fetch(`/api/uploads/${row.dataset.uploadId}`);
                    if (!response.ok) throw new Error(await errorMessage(response));
                    const current = (await response.json()) as UploadedFile;
                    fillRow(row, current);
                    if (current.status === "ready") {
                        notify(`${current.filename} is ready to share in Discord.`);
                        return;
                    }
                    if (current.status === "failed") {
                        notify(`${current.filename} couldn't be converted.`, "warning");
                        return;
                    }
                } catch (error) {
                    console.error("Couldn't check the conversion status:", error);
                }
                window.setTimeout(() => void check(), STATUS_POLL_MS);
            };
            window.setTimeout(() => void check(), STATUS_POLL_MS);
        };
        const addRow = (upload: UploadedFile): void => {
            const row = template.content.firstElementChild?.cloneNode(true);
            if (!(row instanceof HTMLLIElement)) return;
            fillRow(row, upload);
            list.prepend(row);
            empty.hidden = true;
            if (upload.status === "processing") watchConversion(row);
        };
        const upload = async (file: File): Promise<void> => {
            drop.setAttribute("aria-disabled", "true");
            progress.hidden = false;
            progressName.textContent = file.name;
            setProgress(0);
            try {
                const video = file.type.startsWith("video/") ? await readVideo(file) : null;
                const response = await send(file, video, setProgress);
                if (!response.ok) throw new Error(await errorMessage(response));
                const uploaded = (await response.json()) as UploadedFile;
                if (video?.thumbnail) {
                    const thumbnail = await fetch(`/api/uploads/${uploaded.id}/thumbnail`, {
                        method: "POST",
                        headers: { "Content-Type": "image/jpeg" },
                        body: video.thumbnail,
                    });
                    if (!thumbnail.ok) {
                        notify(
                            "Uploaded, but the video preview image couldn't be saved.",
                            "warning",
                        );
                    }
                }
                addRow(uploaded);
                if (uploaded.status === "processing") {
                    notify("Uploaded. Converting it for Discord; share the link once it's ready.");
                } else {
                    await copyLink(uploaded.page_url);
                }
            } catch (error) {
                notify(error instanceof Error ? error.message : "Upload failed.", "error");
            } finally {
                drop.removeAttribute("aria-disabled");
                progress.hidden = true;
                input.value = "";
            }
        };
        const copyLink = async (url: string): Promise<void> => {
            try {
                await navigator.clipboard.writeText(url);
                notify("Link copied. Paste it in Discord.");
            } catch {
                notify(`Couldn't copy automatically. Link: ${url}`, "warning");
            }
        };

        list.querySelectorAll<HTMLElement>('[data-upload-status="processing"]').forEach(
            (status) => {
                const row = status.closest<HTMLElement>("[data-upload-id]");
                if (row) watchConversion(row);
            },
        );

        input.addEventListener("change", () => {
            const file = input.files?.[0];
            if (file) void upload(file);
        });

        drop.addEventListener("dragover", (event) => {
            event.preventDefault();
            drop.dataset.dragging = "true";
        });
        drop.addEventListener("dragleave", () => delete drop.dataset.dragging);
        drop.addEventListener("drop", (event) => {
            event.preventDefault();
            delete drop.dataset.dragging;
            const file = event.dataTransfer?.files[0];
            if (file) void upload(file);
        });

        list.addEventListener("click", (event) => {
            if (!(event.target instanceof Element)) return;
            const copy = event.target.closest<HTMLElement>("[data-upload-copy]");
            if (copy?.dataset.uploadCopy) {
                void copyLink(copy.dataset.uploadCopy);
                return;
            }
            const remove = event.target.closest<HTMLButtonElement>("[data-upload-delete]");
            const row = remove?.closest<HTMLElement>("[data-upload-id]");
            if (!remove || !row?.dataset.uploadId) return;
            pendingDelete = { row, button: remove };
            const name = row.querySelector("[data-upload-name]")?.textContent ?? "this file";
            if (description) {
                description.textContent = `Delete ${name}? Its link will stop working everywhere it was shared. This cannot be undone.`;
            }
            confirmation.showModal();
        });

        const cancelDelete = (): void => {
            if (!confirmButton.disabled) confirmation.close();
        };
        cancelButton.addEventListener("click", cancelDelete);
        confirmation.addEventListener("cancel", (event) => {
            if (confirmButton.disabled) event.preventDefault();
        });
        confirmation.addEventListener("click", (event) => {
            if (event.target !== confirmation) return;
            const bounds = confirmation.getBoundingClientRect();
            if (
                event.clientX < bounds.left ||
                event.clientX > bounds.right ||
                event.clientY < bounds.top ||
                event.clientY > bounds.bottom
            ) {
                cancelDelete();
            }
        });
        confirmButton.addEventListener("click", () => {
            if (!pendingDelete || confirmButton.disabled) return;
            const { row, button } = pendingDelete;
            confirmButton.disabled = true;
            cancelButton.disabled = true;
            button.disabled = true;
            void fetch(`/api/uploads/${row.dataset.uploadId}`, { method: "DELETE" })
                .then(async (response) => {
                    if (!response.ok) throw new Error(await errorMessage(response));
                    row.remove();
                    empty.hidden = list.children.length > 0;
                    notify("File deleted.");
                })
                .catch((error: unknown) => {
                    button.disabled = false;
                    notify(error instanceof Error ? error.message : "Delete failed.", "error");
                })
                .finally(() => {
                    pendingDelete = null;
                    confirmButton.disabled = false;
                    cancelButton.disabled = false;
                    confirmation.close();
                });
        });
    }

    window.initUploads = initUploads;
})();
