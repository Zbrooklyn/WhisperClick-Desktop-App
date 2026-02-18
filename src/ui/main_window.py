import customtkinter as ctk


class MainWindow(ctk.CTk):
    def __init__(self):
        super().__init__()

        self.title("WhisperClick")
        self.geometry("480x560")
        self.resizable(False, False)
        ctk.set_appearance_mode("dark")
        ctk.set_default_color_theme("blue")

        # Callbacks (set by app controller)
        self.on_record_toggle = None
        self.on_mode_change = None
        self.on_model_change = None

        self._build_ui()

    def _build_ui(self):
        # --- Top bar: mode toggle + model selector ---
        top_frame = ctk.CTkFrame(self, fg_color="transparent")
        top_frame.pack(fill="x", padx=20, pady=(16, 0))

        ctk.CTkLabel(top_frame, text="Mode:", font=("", 13)).pack(side="left")
        self.mode_var = ctk.StringVar(value="local")
        self.mode_switch = ctk.CTkSegmentedButton(
            top_frame,
            values=["local", "api"],
            variable=self.mode_var,
            command=self._mode_changed,
        )
        self.mode_switch.pack(side="left", padx=(8, 20))

        ctk.CTkLabel(top_frame, text="Model:", font=("", 13)).pack(side="left")
        self.model_var = ctk.StringVar(value="base")
        self.model_dropdown = ctk.CTkOptionMenu(
            top_frame,
            values=["tiny", "base", "small", "medium", "large"],
            variable=self.model_var,
            command=self._model_changed,
            width=100,
        )
        self.model_dropdown.pack(side="left", padx=(8, 0))

        # --- Record button ---
        self.record_btn = ctk.CTkButton(
            self,
            text="Start Recording",
            font=("", 20, "bold"),
            height=80,
            width=260,
            fg_color="#2ecc71",
            hover_color="#27ae60",
            command=self._record_clicked,
        )
        self.record_btn.pack(pady=(30, 10))

        # --- Status label ---
        self.status_label = ctk.CTkLabel(
            self, text="Ready  |  Ctrl+Shift+R", font=("", 13), text_color="gray"
        )
        self.status_label.pack(pady=(0, 16))

        # --- Transcription output ---
        self.text_box = ctk.CTkTextbox(self, width=420, height=260, font=("", 14))
        self.text_box.pack(padx=20)
        self.text_box.configure(state="disabled")

        # --- Copy button ---
        self.copy_btn = ctk.CTkButton(
            self,
            text="Copy to Clipboard",
            width=200,
            command=self._copy_text,
        )
        self.copy_btn.pack(pady=(12, 16))

    # --- UI state updates (called by app controller) ---

    def set_state_idle(self):
        self.record_btn.configure(
            text="Start Recording",
            fg_color="#2ecc71",
            hover_color="#27ae60",
            state="normal",
        )
        self.status_label.configure(text="Ready  |  Ctrl+Shift+R")

    def set_state_recording(self):
        self.record_btn.configure(
            text="Stop Recording",
            fg_color="#e74c3c",
            hover_color="#c0392b",
            state="normal",
        )
        self.status_label.configure(text="Recording...")

    def set_state_processing(self):
        self.record_btn.configure(
            text="Transcribing...",
            fg_color="#7f8c8d",
            hover_color="#7f8c8d",
            state="disabled",
        )
        self.status_label.configure(text="Processing audio...")

    def set_state_completed(self, text: str):
        self.text_box.configure(state="normal")
        self.text_box.delete("1.0", "end")
        self.text_box.insert("1.0", text)
        self.text_box.configure(state="disabled")
        self.set_state_idle()
        self.status_label.configure(text="Done  |  Ctrl+Shift+R to record again")

    def set_state_error(self, message: str):
        self.text_box.configure(state="normal")
        self.text_box.delete("1.0", "end")
        self.text_box.insert("1.0", f"Error: {message}")
        self.text_box.configure(state="disabled")
        self.set_state_idle()
        self.status_label.configure(text="Error occurred. Try again.")

    def set_model_dropdown_enabled(self, enabled: bool):
        self.model_dropdown.configure(state="normal" if enabled else "disabled")

    # --- Internal handlers ---

    def _record_clicked(self):
        if self.on_record_toggle:
            self.on_record_toggle()

    def _mode_changed(self, value):
        self.set_model_dropdown_enabled(value == "local")
        if self.on_mode_change:
            self.on_mode_change(value)

    def _model_changed(self, value):
        if self.on_model_change:
            self.on_model_change(value)

    def _copy_text(self):
        self.text_box.configure(state="normal")
        text = self.text_box.get("1.0", "end").strip()
        self.text_box.configure(state="disabled")
        if text:
            self.clipboard_clear()
            self.clipboard_append(text)
            self.status_label.configure(text="Copied!")
