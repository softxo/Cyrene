window.initVerify = function () {

    const verificationData =
        document.getElementById(
            "verification-data"
        );

    const verificationCode =
        document.getElementById(
            "verification-code"
        );

    const verificationStatus =
        document.getElementById(
            "verification-status"
        );


    if (
        !verificationData ||
        !verificationCode ||
        !verificationStatus
    ) {

        console.error(
            "Verification page elements not found."
        );

        return;
    }


    const nextUrl =
        verificationData.dataset.next;


    let verificationToken = null;
    let polling = null;


    // =========================================================
    // Storage
    // Keep the current verification request when the mobile
    // browser reloads or restores the page.
    // =========================================================

    const STORAGE_TOKEN =
        "cyrene_verification_token";

    const STORAGE_CODE =
        "cyrene_verification_code";


    // =========================================================
    // Create Verification
    // =========================================================

    async function createVerification() {

        try {

            verificationStatus.textContent =
                "Generating verification code...";


            const response =
                await fetch(
                    "/api/verify/create",
                    {
                        method: "POST"
                    }
                );


            if (!response.ok) {

                throw new Error(
                    `Failed to create verification request: ${response.status}`
                );

            }


            const data =
                await response.json();


            verificationToken =
                data.token;


            verificationCode.textContent =
                data.code;


            // Save the request so a mobile browser reload does
            // not generate a completely new verification request.
            sessionStorage.setItem(
                STORAGE_TOKEN,
                verificationToken
            );

            sessionStorage.setItem(
                STORAGE_CODE,
                data.code
            );


            verificationStatus.textContent =
                "Awaiting Verification";


            startPolling();


        } catch (error) {

            console.error(
                "Verification creation failed:",
                error
            );


            verificationStatus.textContent =
                "Unable to start verification.";

        }

    }


    // =========================================================
    // Restore Existing Verification
    // =========================================================

    function restoreVerification() {

        const savedToken =
            sessionStorage.getItem(
                STORAGE_TOKEN
            );

        const savedCode =
            sessionStorage.getItem(
                STORAGE_CODE
            );


        if (
            !savedToken ||
            !savedCode
        ) {

            return false;

        }


        verificationToken =
            savedToken;


        verificationCode.textContent =
            savedCode;


        verificationStatus.textContent =
            "Awaiting Verification";


        startPolling();


        return true;

    }


    // =========================================================
    // Polling
    // =========================================================

    function startPolling() {

        if (polling) {

            clearInterval(
                polling
            );

        }


        polling =
            setInterval(
                checkVerification,
                2000
            );


        // Check immediately instead of waiting 2 seconds.
        checkVerification();

    }


    async function checkVerification() {

        if (!verificationToken) {

            return;

        }


        try {

            const response =
                await fetch(
                    `/api/verify/status?token=${
                        encodeURIComponent(
                            verificationToken
                        )
                    }`,
                    {
                        cache: "no-store"
                    }
                );


            // The verification request no longer exists.
            if (
                response.status === 404
            ) {

                clearInterval(
                    polling
                );

                polling = null;


                sessionStorage.removeItem(
                    STORAGE_TOKEN
                );

                sessionStorage.removeItem(
                    STORAGE_CODE
                );


                verificationStatus.textContent =
                    "This verification request has expired. Please refresh the page.";


                return;

            }


            if (!response.ok) {

                return;

            }


            const data =
                await response.json();


            if (!data.verified) {

                return;

            }


            // =================================================
            // Verification succeeded
            // =================================================

            clearInterval(
                polling
            );

            polling = null;


            // The request has been completed, so don't restore
            // this verification request if the page is revisited.
            sessionStorage.removeItem(
                STORAGE_TOKEN
            );

            sessionStorage.removeItem(
                STORAGE_CODE
            );


            verificationStatus.textContent =
                "Successfully connected to Discord.";


            setTimeout(() => {

                window.location.href =
                    nextUrl;

            }, 800);


        } catch (error) {

            console.error(
                "Verification polling failed:",
                error
            );

        }

    }


    // =========================================================
    // Mobile Browser Handling
    // =========================================================

    document.addEventListener(
        "visibilitychange",
        () => {

            if (
                document.visibilityState !== "visible"
            ) {

                return;

            }


            // The browser may have suspended the polling while
            // Discord was open. Immediately check again when
            // the user returns to the page.

            if (
                verificationToken &&
                !polling
            ) {

                startPolling();

            } else if (
                verificationToken
            ) {

                checkVerification();

            }

        }
    );


    // =========================================================
    // Page Restoration / Back-Forward Cache
    // =========================================================

    window.addEventListener(
        "pageshow",
        () => {

            if (
                verificationToken
            ) {

                checkVerification();

            }

        }
    );


    // =========================================================
    // Initialisation
    // =========================================================

    // IMPORTANT:
    //
    // Do NOT automatically create a new verification request
    // if one already exists in this browser session.
    //
    // This is what prevents the mobile "code changes after
    // returning from Discord" problem.

    const restored =
        restoreVerification();


    if (!restored) {

        createVerification();

    }

};