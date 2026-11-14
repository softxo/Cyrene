"""Public documentation pages."""

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import HTMLResponse

from website.server.content.docs_content import (
    COMMAND_GROUPS,
    DEFAULT_PREFIX,
    DOCS_PAGES,
    DOCS_SECTIONS,
    SEARCH_INDEX,
)
from website.server.core.templating import templates

router = APIRouter()


def docs_context(request: Request, **context):
    return {
        "request": request,
        "sections": DOCS_SECTIONS,
        "search_index": SEARCH_INDEX,
        "command_groups": COMMAND_GROUPS,
        "prefix": DEFAULT_PREFIX,
        **context,
    }


@router.get("/docs", response_class=HTMLResponse)
async def docs_index(request: Request):
    return templates.TemplateResponse(
        request=request,
        name="docs/index.html",
        context=docs_context(request, current_slug=None),
    )


@router.get("/docs/{slug}", response_class=HTMLResponse)
async def docs_page(request: Request, slug: str):
    index = next((i for i, page in enumerate(DOCS_PAGES) if page["slug"] == slug), None)
    if index is None:
        raise HTTPException(status_code=404, detail="Documentation page not found")

    page = DOCS_PAGES[index]
    template = "docs/commands.html" if "groups" in page else f"docs/pages/{slug}.html"

    return templates.TemplateResponse(
        request=request,
        name=template,
        context=docs_context(
            request,
            current_slug=slug,
            page=page,
            previous_page=DOCS_PAGES[index - 1] if index > 0 else None,
            next_page=DOCS_PAGES[index + 1] if index < len(DOCS_PAGES) - 1 else None,
        ),
    )
