"""Load BUILDWISE evidence and search its cited passages offline.

Run `python -m app.rag validate` from backend/ to check the releases and reviews.
For hybrid retrieval, supply a document encoder to `points.build_points(corpus,
embed=encode_document)`, then pass `query_vector=encode_query(question)` and the
question text to `search.search`. Both encoders must share the same vector space.
Omitting embeddings enables keyword search without downloading a model.
"""
