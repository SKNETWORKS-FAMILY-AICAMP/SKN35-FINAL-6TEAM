"""Small bidirectional BERT encoder with explicit NumPy forward and reverse passes."""

from dataclasses import dataclass

import numpy as np

from app.rag.korean_tokenizer import PAD


@dataclass(frozen=True)
class BertConfig:
    width: int = 48
    heads: int = 4
    layers: int = 2
    intermediate: int = 96
    token_limit: int = 96
    output: int = 384


def softmax(x):
    exp = np.exp(x - x.max(axis=-1, keepdims=True))
    return exp / exp.sum(axis=-1, keepdims=True)


def _norm(x, scale, bias):
    centered = x - x.mean(axis=-1, keepdims=True)
    inv = 1 / np.sqrt((centered**2).mean(axis=-1, keepdims=True) + 1e-5)
    normalized = centered * inv
    return normalized * scale + bias, (normalized, inv)


def _norm_grad(dy, cache, scale):
    normalized, inv = cache
    dx = dy * scale
    axes = tuple(range(dy.ndim - 1))
    return (
        inv
        * (
            dx
            - dx.mean(axis=-1, keepdims=True)
            - normalized * (dx * normalized).mean(axis=-1, keepdims=True)
        ),
        (dy * normalized).sum(axis=axes),
        dy.sum(axis=axes),
    )


def _linear_grad(x, dy, weight):
    inputs = x.reshape(-1, x.shape[-1])
    outputs = dy.reshape(-1, dy.shape[-1])
    return dy @ weight.T, inputs.T @ outputs, outputs.sum(axis=0)


class BertEncoder:
    def __init__(self, vocab_size, config, rng):
        self.config = config
        w = config.width
        if w % config.heads:
            raise ValueError("Hidden width must be divisible by head count")
        self.params = {}

        def matrix(name, rows, cols, std):
            self.params[name] = (rng.standard_normal((rows, cols)) * std).astype(np.float32)

        def linear(name, rows, cols):
            matrix(name, rows, cols, (2 / (rows + cols)) ** 0.5)
            self.params[name + "_bias"] = np.zeros(cols, dtype=np.float32)

        def norm(name):
            self.params[name] = np.ones(w, dtype=np.float32)
            self.params[name + "_bias"] = np.zeros(w, dtype=np.float32)

        matrix("word", vocab_size, w, 0.02)
        matrix("position", config.token_limit, w, 0.02)
        norm("embedding_norm")
        for layer in range(config.layers):
            tag = f"layer{layer}_"
            linear(tag + "qkv", w, 3 * w)
            linear(tag + "attention_out", w, w)
            norm(tag + "attention_norm")
            linear(tag + "ff1", w, config.intermediate)
            linear(tag + "ff2", config.intermediate, w)
            norm(tag + "ff_norm")
        linear("projection", w, config.output)

    def _heads(self, x):
        batch, length, width = x.shape
        return x.reshape(batch, length, self.config.heads, width // self.config.heads).swapaxes(
            1, 2
        )

    @staticmethod
    def _join(x):
        batch, heads, length, size = x.shape
        return x.swapaxes(1, 2).reshape(batch, length, heads * size)

    def forward(self, ids):
        p = self.params
        x, emb_cache = _norm(
            p["word"][ids] + p["position"][: ids.shape[1]],
            p["embedding_norm"],
            p["embedding_norm_bias"],
        )
        blocks = []
        for i in range(self.config.layers):
            tag = f"layer{i}_"
            qkv = x @ p[tag + "qkv"] + p[tag + "qkv_bias"]
            q, k, v = (self._heads(part) for part in np.split(qkv, 3, axis=-1))
            scores = (q @ k.swapaxes(-2, -1)) * (q.shape[-1] ** -0.5)
            weights = softmax(np.where(ids[:, None, None, :] != PAD, scores, -1e9))
            context = self._join(weights @ v)
            h, attn_cache = _norm(
                x + context @ p[tag + "attention_out"] + p[tag + "attention_out_bias"],
                p[tag + "attention_norm"],
                p[tag + "attention_norm_bias"],
            )
            z = h @ p[tag + "ff1"] + p[tag + "ff1_bias"]
            tanh = np.tanh(0.79788456 * (z + 0.044715 * z**3))
            gelu = 0.5 * z * (1 + tanh)
            out, ff_cache = _norm(
                h + gelu @ p[tag + "ff2"] + p[tag + "ff2_bias"],
                p[tag + "ff_norm"],
                p[tag + "ff_norm_bias"],
            )
            blocks.append((x, q, k, v, weights, context, h, attn_cache, z, tanh, gelu, ff_cache))
            x = out
        return x, (ids, emb_cache, blocks)

    def backward(self, dy, cache):
        ids, emb_cache, blocks = cache
        p = self.params
        grads = {}

        def linear(name, x, dy):
            dx, grads[name], grads[name + "_bias"] = _linear_grad(x, dy, p[name])
            return dx

        def norm(name, dy, cached):
            dx, grads[name], grads[name + "_bias"] = _norm_grad(dy, cached, p[name])
            return dx

        for i in reversed(range(len(blocks))):
            tag = f"layer{i}_"
            x, q, k, v, weights, context, h, attn_cache, z, tanh, gelu, ff_cache = blocks[i]
            residual = norm(tag + "ff_norm", dy, ff_cache)
            dgelu = linear(tag + "ff2", gelu, residual)
            dz = dgelu * (
                0.5 * (1 + tanh) + 0.5 * z * (1 - tanh**2) * 0.79788456 * (1 + 3 * 0.044715 * z**2)
            )
            dh = residual + linear(tag + "ff1", h, dz)
            residual = norm(tag + "attention_norm", dh, attn_cache)
            dc = self._heads(linear(tag + "attention_out", context, residual))
            dw = dc @ v.swapaxes(-2, -1)
            ds = weights * (dw - (dw * weights).sum(axis=-1, keepdims=True)) * (q.shape[-1] ** -0.5)
            dq = ds @ k
            dk = ds.swapaxes(-2, -1) @ q
            dv = weights.swapaxes(-2, -1) @ dc
            dqkv = np.concatenate([self._join(d) for d in (dq, dk, dv)], axis=-1)
            dy = residual + linear(tag + "qkv", x, dqkv)
        de = norm("embedding_norm", dy, emb_cache)
        grads["word"] = np.zeros_like(p["word"])
        np.add.at(grads["word"], ids, de)
        grads["position"] = np.zeros_like(p["position"])
        grads["position"][: ids.shape[1]] = de.sum(axis=0)
        return grads

    def vectors(self, ids):
        hidden, cache = self.forward(ids)
        cls = hidden[:, 0]
        raw = cls @ self.params["projection"] + self.params["projection_bias"]
        length = np.maximum(np.linalg.norm(raw, axis=-1, keepdims=True), 1e-12)
        unit = raw / length
        return unit, (cache, cls, hidden.shape, unit, length)

    def vector_grad(self, dy, cached):
        cache, cls, shape, unit, length = cached
        draw = (dy - unit * (dy * unit).sum(axis=-1, keepdims=True)) / length
        dcls, dw, db = _linear_grad(cls, draw, self.params["projection"])
        dh = np.zeros(shape, dtype=draw.dtype)
        dh[:, 0] = dcls
        grads = self.backward(dh, cache)
        grads.update(projection=dw, projection_bias=db)
        return grads


class Adam:
    def __init__(self, rate):
        self.rate = rate
        self.step = 0
        self.m = {}
        self.v = {}

    def update(self, params, grads):
        self.step += 1
        for name, g in grads.items():
            if name not in self.m:
                self.m[name] = np.zeros_like(g)
                self.v[name] = np.zeros_like(g)
            m, v = self.m[name], self.v[name]
            m *= 0.9
            m += 0.1 * g
            v *= 0.999
            v += 0.001 * g**2
            params[name] -= (
                self.rate
                * (m / (1 - 0.9**self.step))
                / (np.sqrt(v / (1 - 0.999**self.step)) + 1e-8)
            )
