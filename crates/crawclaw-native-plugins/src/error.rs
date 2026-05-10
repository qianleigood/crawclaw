use thiserror::Error;

pub type NativeResult<T> = Result<T, NativeError>;

#[derive(Debug, Error)]
pub enum NativeError {
    #[error("{0}")]
    Message(String),
    #[error("{0}")]
    InvalidInput(String),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("http error: {0}")]
    Http(#[from] reqwest::Error),
    #[error("schema error: {0}")]
    Schema(String),
}

impl NativeError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::InvalidInput(_) | Self::Json(_) | Self::Schema(_) => "invalid_input",
            Self::Io(_) => "io_error",
            Self::Http(_) => "http_error",
            Self::Message(_) => "runtime_error",
        }
    }
}

pub fn invalid_input(message: impl Into<String>) -> NativeError {
    NativeError::InvalidInput(message.into())
}

pub fn runtime_error(message: impl Into<String>) -> NativeError {
    NativeError::Message(message.into())
}
