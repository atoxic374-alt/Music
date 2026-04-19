use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtractRequest {
    pub url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtractResult {
    pub stream_url: String,
    pub codec: String,
    pub plugin: String,
}

pub trait SourceExtractor: Send + Sync {
    fn name(&self) -> &'static str;
    fn can_handle(&self, input: &str) -> bool;
    fn extract(&self, req: &ExtractRequest) -> anyhow::Result<ExtractResult>;
}

pub struct YtDlpExtractor;

impl SourceExtractor for YtDlpExtractor {
    fn name(&self) -> &'static str {
        "yt-dlp"
    }

    fn can_handle(&self, input: &str) -> bool {
        input.contains("youtube.com") || input.contains("youtu.be") || input.contains("soundcloud.com")
    }

    fn extract(&self, req: &ExtractRequest) -> anyhow::Result<ExtractResult> {
        // Placeholder for dynamic plugin runner / external process.
        Ok(ExtractResult {
            stream_url: req.url.clone(),
            codec: "opus".to_string(),
            plugin: self.name().to_string(),
        })
    }
}

pub struct ExtractorRegistry {
    plugins: Vec<Box<dyn SourceExtractor>>,
}

impl ExtractorRegistry {
    pub fn default_registry() -> Self {
        Self {
            plugins: vec![Box::new(YtDlpExtractor)],
        }
    }

    pub fn resolve(&self, req: &ExtractRequest) -> anyhow::Result<ExtractResult> {
        for plugin in &self.plugins {
            if plugin.can_handle(&req.url) {
                return plugin.extract(req);
            }
        }

        anyhow::bail!("no extractor plugin for url")
    }
}
