import threading
import customtkinter as ctk
from src.models import MODEL_INFO, is_model_downloaded, download_model


class SetupScreen(ctk.CTkToplevel):
    """First-run onboarding screen for downloading a Whisper model."""

    def __init__(self, parent, on_complete):
        super().__init__(parent)
        self.on_complete = on_complete
        self._downloading = False

        self.title("WhisperClick - Setup")
        self.geometry("500x420")
        self.resizable(False, False)
        self.grab_set()  # modal
        self.protocol("WM_DELETE_WINDOW", self._on_close)

        self._build_ui()

    def _build_ui(self):
        # Header
        ctk.CTkLabel(
            self, text="Welcome to WhisperClick", font=("", 22, "bold")
        ).pack(pady=(24, 4))
        ctk.CTkLabel(
            self,
            text="A speech-to-text model is needed for local transcription.\nChoose a model to download:",
            font=("", 13),
            text_color="gray",
        ).pack(pady=(0, 16))

        # Model selection
        self.model_var = ctk.StringVar(value="base")
        models_frame = ctk.CTkFrame(self, fg_color="transparent")
        models_frame.pack(fill="x", padx=30)

        for name, info in MODEL_INFO.items():
            downloaded = is_model_downloaded(name)
            label = f"{name}  ({info['size_mb']} MB) - {info['description']}"
            if downloaded:
                label += "  [downloaded]"
            btn = ctk.CTkRadioButton(
                models_frame,
                text=label,
                variable=self.model_var,
                value=name,
                font=("", 12),
            )
            btn.pack(anchor="w", pady=3)

        # Progress area
        self.progress_frame = ctk.CTkFrame(self, fg_color="transparent")
        self.progress_frame.pack(fill="x", padx=30, pady=(16, 0))

        self.progress_bar = ctk.CTkProgressBar(self.progress_frame, width=420)
        self.progress_bar.set(0)
        self.progress_bar.pack()

        self.progress_label = ctk.CTkLabel(
            self.progress_frame, text="", font=("", 12), text_color="gray"
        )
        self.progress_label.pack(pady=(4, 0))
        self.progress_frame.pack_forget()  # hidden initially

        # Buttons
        btn_frame = ctk.CTkFrame(self, fg_color="transparent")
        btn_frame.pack(pady=(20, 16))

        self.download_btn = ctk.CTkButton(
            btn_frame,
            text="Download & Continue",
            width=200,
            height=40,
            font=("", 14, "bold"),
            command=self._start_download,
        )
        self.download_btn.pack(side="left", padx=(0, 10))

        self.skip_btn = ctk.CTkButton(
            btn_frame,
            text="Skip (API only)",
            width=140,
            height=40,
            fg_color="transparent",
            border_width=1,
            text_color=("gray10", "gray90"),
            command=self._skip,
        )
        self.skip_btn.pack(side="left")

    def _start_download(self):
        model = self.model_var.get()
        if is_model_downloaded(model):
            self._finish(model)
            return

        self._downloading = True
        self.download_btn.configure(state="disabled", text="Downloading...")
        self.skip_btn.configure(state="disabled")
        self.progress_frame.pack(fill="x", padx=30, pady=(16, 0))
        self.progress_label.configure(text="Starting download...")

        thread = threading.Thread(
            target=self._download_worker, args=(model,), daemon=True
        )
        thread.start()

    def _download_worker(self, model):
        try:
            download_model(model, progress_callback=self._on_progress)
            self.after(0, lambda: self._finish(model))
        except Exception as e:
            self.after(0, lambda: self._on_error(str(e)))

    def _on_progress(self, downloaded, total):
        if total > 0:
            pct = downloaded / total
            mb_done = downloaded / (1024 * 1024)
            mb_total = total / (1024 * 1024)
            self.after(0, lambda: self._update_progress(pct, mb_done, mb_total))

    def _update_progress(self, pct, mb_done, mb_total):
        self.progress_bar.set(pct)
        self.progress_label.configure(
            text=f"{mb_done:.0f} / {mb_total:.0f} MB  ({pct * 100:.0f}%)"
        )

    def _on_error(self, message):
        self._downloading = False
        self.download_btn.configure(state="normal", text="Retry Download")
        self.skip_btn.configure(state="normal")
        self.progress_label.configure(text=f"Error: {message}", text_color="red")

    def _finish(self, model):
        self._downloading = False
        self.on_complete(model)
        self.grab_release()
        self.destroy()

    def _skip(self):
        self.on_complete(None)  # None = no local model, API-only
        self.grab_release()
        self.destroy()

    def _on_close(self):
        if not self._downloading:
            self._skip()
