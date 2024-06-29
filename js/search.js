document.addEventListener("DOMContentLoaded", function() {
    const searchInput = document.getElementById('search');
    const postList = document.querySelectorAll('.single-list');
    const resultCount = document.getElementById('search-result-count');
    const filteredPostsContainer = document.getElementById('filtered-posts');

    // Save all posts HTML from the first page
    const allPosts = Array.from(postList).map(post => post.outerHTML);
    let additionalPostsLoaded = false; // Flag to track if additional posts have been loaded

    // Function to load content from another page
    async function loadContent(url) {
        try {
            const response = await fetch(url);
            const text = await response.text();
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = text;
            return tempDiv.querySelectorAll('.single-list');
        } catch (error) {
            console.error('Error loading content:', error);
            return [];
        }
    }

    // Load additional posts from other pages
    async function loadAdditionalPosts() {
        const pages = [
            'what will you do p2.html',
            'what will you do p3.html',
            'what will you do p4.html'
        ];

        for (const page of pages) {
            const additionalPosts = await loadContent(page);
            additionalPosts.forEach(post => {
                allPosts.push(post.outerHTML);
            });
        }

        additionalPostsLoaded = true;
        filterPosts(); // Reapply filter with additional posts
    }

    // Function to filter posts
    function filterPosts() {
        let filter = searchInput.value.toLowerCase();
        let count = 0;
        filteredPostsContainer.innerHTML = ''; // Clear the container

        allPosts.forEach(postHTML => {
            let tempDiv = document.createElement('div');
            tempDiv.innerHTML = postHTML;
            let postText = tempDiv.innerText.toLowerCase();
            if (postText.includes(filter)) {
                filteredPostsContainer.innerHTML += postHTML;  // Add matching post
                count++;
            }
        });

        resultCount.innerText = `${count} results found for “${filter}”`;

        // If no input, show posts from the first page only
        if (filter === '') {
            filteredPostsContainer.innerHTML = Array.from(postList).map(post => post.outerHTML).join('');
            resultCount.innerText = `results found for “What will you do?(WWYD)”`;
        } else if (!additionalPostsLoaded) {
            // Load additional posts if not already loaded
            loadAdditionalPosts();
        }
    }

    // Event listener for input event
    searchInput.addEventListener('input', filterPosts);

    // Initial load
    filterPosts();
});
