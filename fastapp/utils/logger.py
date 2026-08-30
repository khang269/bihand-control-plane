import logging
import os
import datetime

class DailyLineRotatingFileHandler(logging.Handler):
    """
    Custom logging handler that creates a new directory for each day
    and rotates the log file every `max_lines` lines.
    """
    def __init__(self, base_dir="logs", max_lines=1000):
        super().__init__()
        self.base_dir = base_dir
        self.max_lines = max_lines
        self.current_date = datetime.date.today()
        self.current_lines = 0
        self.file_index = 1
        self.current_file = None
        self.stream = None
        self._open_new_file()

    def _get_dir_for_today(self):
        date_str = self.current_date.strftime("%Y-%m-%d")
        dir_path = os.path.join(self.base_dir, date_str)
        os.makedirs(dir_path, exist_ok=True)
        return dir_path

    def _open_new_file(self):
        if self.stream:
            self.stream.close()
            self.stream = None
        
        dir_path = self._get_dir_for_today()
        
        # When opening, find the correct file index to append to or create
        if self.current_lines == 0:
            self.file_index = 1
            while os.path.exists(os.path.join(dir_path, f"server_{self.file_index}.log")):
                try:
                    with open(os.path.join(dir_path, f"server_{self.file_index}.log"), 'r', encoding='utf-8') as f:
                        lines = sum(1 for _ in f)
                    if lines < self.max_lines:
                        self.current_lines = lines
                        break
                except Exception:
                    pass
                self.file_index += 1

        file_path = os.path.join(dir_path, f"server_{self.file_index}.log")
        self.current_file = file_path
        self.stream = open(self.current_file, 'a', encoding='utf-8')

    def emit(self, record):
        try:
            msg = self.format(record)
            today = datetime.date.today()
            
            # Check for date change
            if today != self.current_date:
                self.current_date = today
                self.current_lines = 0
                self.file_index = 1
                self._open_new_file()
                
            # Check for line limit
            if self.current_lines >= self.max_lines:
                self.file_index += 1
                self.current_lines = 0
                self._open_new_file()
                
            if not self.stream or self.stream.closed:
                self._open_new_file()
                
            self.stream.write(msg + '\n')
            self.stream.flush()
            self.current_lines += msg.count('\n') + 1
        except Exception:
            self.handleError(record)
            
    def close(self):
        if self.stream:
            self.stream.close()
        super().close()

def setup_logging():
    # Remove all default handlers
    root_logger = logging.getLogger()
    for handler in root_logger.handlers[:]:
        root_logger.removeHandler(handler)
        
    root_logger.setLevel(logging.INFO)
    
    formatter = logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s')
    
    # Add console handler
    console_handler = logging.StreamHandler()
    console_handler.setFormatter(formatter)
    root_logger.addHandler(console_handler)
    
    # Add our custom rotating file handler
    file_handler = DailyLineRotatingFileHandler(base_dir="logs", max_lines=1000)
    file_handler.setFormatter(formatter)
    root_logger.addHandler(file_handler)
    
    # Also attach it to uvicorn loggers so they use the same handler
    for logger_name in ["uvicorn", "uvicorn.error", "uvicorn.access"]:
        uvicorn_logger = logging.getLogger(logger_name)
        uvicorn_logger.handlers = []
        uvicorn_logger.addHandler(console_handler)
        uvicorn_logger.addHandler(file_handler)
        uvicorn_logger.propagate = False
