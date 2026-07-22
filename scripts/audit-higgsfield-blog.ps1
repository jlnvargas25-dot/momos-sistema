[CmdletBinding()]
param(
    [ValidateRange(0, 10000)]
    [int]$Offset = 0,

    [ValidateRange(1, 100)]
    [int]$Limit = 15,

    [switch]$InventoryOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$categories = [ordered]@{
    'How To Guides' = 'https://higgsfield.ai/blog/How-to-guides'
    'Listicles' = 'https://higgsfield.ai/blog/Listicles'
    'Fresh Release' = 'https://higgsfield.ai/blog/Fresh-Releases'
    'Social Media Tips' = 'https://higgsfield.ai/blog/Social-Media-Tips'
    'Insights on Future Models' = 'https://higgsfield.ai/blog/future-models-insights'
}

$categoryPaths = @(
    '/blog',
    '/blog/How-to-guides',
    '/blog/Listicles',
    '/blog/Fresh-Releases',
    '/blog/Social-Media-Tips',
    '/blog/future-models-insights'
)

function ConvertTo-PlainText {
    param([string]$Html)

    if ([string]::IsNullOrWhiteSpace($Html)) {
        return ''
    }

    $withoutTags = $Html -replace '<script\b[^>]*>[\s\S]*?</script>', ' '
    $withoutTags = $withoutTags -replace '<style\b[^>]*>[\s\S]*?</style>', ' '
    $withoutTags = $withoutTags -replace '<svg\b[^>]*>[\s\S]*?</svg>', ' '
    $withoutTags = $withoutTags -replace '<[^>]+>', ' '
    $decoded = [System.Net.WebUtility]::HtmlDecode($withoutTags)
    return (($decoded -replace '\s+', ' ').Trim())
}

$urlCategories = @{}
foreach ($entry in $categories.GetEnumerator()) {
    $response = Invoke-WebRequest -Uri $entry.Value -UseBasicParsing
    foreach ($link in $response.Links) {
        $path = [string]$link.href
        if (-not $path.StartsWith('/blog/')) {
            continue
        }

        $path = $path.Split('?')[0].TrimEnd('/')
        if ([string]::IsNullOrWhiteSpace($path) -or $categoryPaths -contains $path) {
            continue
        }

        if (-not $urlCategories.ContainsKey($path)) {
            $urlCategories[$path] = [System.Collections.Generic.List[string]]::new()
        }
        if (-not $urlCategories[$path].Contains($entry.Key)) {
            $urlCategories[$path].Add($entry.Key)
        }
    }
}

$allPaths = @($urlCategories.Keys | Sort-Object)
$categoryCounts = [ordered]@{}
foreach ($categoryName in $categories.Keys) {
    $categoryCounts[$categoryName] = @(
        $urlCategories.GetEnumerator() |
            Where-Object { $_.Value -contains $categoryName }
    ).Count
}

if ($InventoryOnly) {
    [ordered]@{
        source = 'https://higgsfield.ai/blog'
        audited_at_utc = [DateTime]::UtcNow.ToString('o')
        total_unique_article_urls = $allPaths.Count
        category_counts = $categoryCounts
        urls = @($allPaths | ForEach-Object { 'https://higgsfield.ai' + $_ })
    } | ConvertTo-Json -Depth 5
    return
}

$selectedPaths = @($allPaths | Select-Object -Skip $Offset -First $Limit)
$articles = [System.Collections.Generic.List[object]]::new()

foreach ($path in $selectedPaths) {
    $url = 'https://higgsfield.ai' + $path
    try {
        $response = Invoke-WebRequest -Uri $url -UseBasicParsing
        $html = [string]$response.Content

        $titleMatch = [regex]::Match($html, '<title[^>]*>(.*?)</title>', 'Singleline,IgnoreCase')
        $title = ConvertTo-PlainText $titleMatch.Groups[1].Value

        $dateMatch = [regex]::Match($html, '"datePublished"\s*:\s*"([^"]+)"', 'IgnoreCase')
        $published = $dateMatch.Groups[1].Value

        $descriptionMatch = [regex]::Match(
            $html,
            '<meta[^>]+name="description"[^>]+content="([^"]*)"',
            'IgnoreCase'
        )
        if (-not $descriptionMatch.Success) {
            $descriptionMatch = [regex]::Match(
                $html,
                '<meta[^>]+property="og:description"[^>]+content="([^"]*)"',
                'IgnoreCase'
            )
        }
        $description = ConvertTo-PlainText $descriptionMatch.Groups[1].Value

        $articleMatches = [regex]::Matches(
            $html,
            '<article\b[^>]*>([\s\S]*?)</article>',
            'IgnoreCase'
        )
        $articleHtml = $html
        if ($articleMatches.Count -gt 0) {
            $articleHtml = @(
                $articleMatches |
                    ForEach-Object {
                        [pscustomobject]@{
                            Html = $_.Groups[1].Value
                            TextLength = (ConvertTo-PlainText $_.Groups[1].Value).Length
                        }
                    } |
                    Sort-Object -Property TextLength -Descending |
                    Select-Object -First 1
            )[0].Html
        }

        $headings = @(
            [regex]::Matches($articleHtml, '<(h1|h2|h3)[^>]*>(.*?)</\1>', 'Singleline,IgnoreCase') |
                ForEach-Object { ConvertTo-PlainText $_.Groups[2].Value } |
                Where-Object {
                    $_ -and
                    $_ -ne 'Higgsfield AI' -and
                    $_ -notmatch '^THE ULTIMATE' -and
                    $_ -notmatch '^Discover more$' -and
                    $_ -notmatch '^Got any questions'
                } |
                Select-Object -Unique -First 12
        )

        $segments = @(
            [regex]::Matches($articleHtml, '<(p|li)[^>]*>(.*?)</\1>', 'Singleline,IgnoreCase') |
                ForEach-Object { ConvertTo-PlainText $_.Groups[2].Value } |
                Where-Object {
                    $_.Length -ge 45 -and
                    $_ -notmatch '^(About|Trust|Careers|Contact|Pricing|Apps|Image|Video|Edit)$' -and
                    $_ -notmatch '^535 Mission St' -and
                    $_ -notmatch '© 20\d\d Higgsfield' -and
                    $_ -notmatch 'Your browser does not support'
                } |
                Select-Object -Unique
        )

        $instructional = @(
            $segments |
                Where-Object {
                    $_ -match '(?i)\b(use|choose|start|avoid|keep|prompt|workflow|step|tip|best|should|do not|don''t|recommend|upload|reference|camera|lighting|audio|character|product|marketing|generate|edit|consisten|motion)\b'
                } |
                Select-Object -First 3
        )
        if ($instructional.Count -lt 3) {
            $instructional = @($segments | Select-Object -First 3)
        }

        $articles.Add([ordered]@{
            url = $url
            categories = @($urlCategories[$path])
            published = $published
            title = $title
            description = $description
            headings = $headings
            reading_extracts = $instructional
            status_code = [int]$response.StatusCode
        })
    }
    catch {
        $articles.Add([ordered]@{
            url = $url
            categories = @($urlCategories[$path])
            error = $_.Exception.Message
        })
    }
}

[ordered]@{
    source = 'https://higgsfield.ai/blog'
    audited_at_utc = [DateTime]::UtcNow.ToString('o')
    total_unique_articles = $allPaths.Count
    offset = $Offset
    requested_limit = $Limit
    returned = $articles.Count
    articles = $articles
} | ConvertTo-Json -Depth 8
