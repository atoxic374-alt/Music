use bytes::Bytes;
use criterion::{criterion_group, criterion_main, Criterion};

fn bench_bytes_clone(c: &mut Criterion) {
    c.bench_function("zero_copy_bytes_clone", |b| {
        let payload = Bytes::from(vec![0u8; 4096]);
        b.iter(|| {
            let _cloned = payload.clone();
        })
    });
}

criterion_group!(benches, bench_bytes_clone);
criterion_main!(benches);
