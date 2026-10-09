//! Unified error type for commands. Expand variants as modules land.
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("network error: {0}")]
    Network(String),
    #[error("internal error: {0}")]
    Internal(String),
}

impl serde::Serialize for AppError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;
