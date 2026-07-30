const socket = io('https://rekserver.onrender.com');

const statusBadge = document.getElementById('status');
const complaintList = document.getElementById('complaintList');


// Monitor connection status
socket.on('connect', () => {
    statusBadge.innerText = "🟢 Connected (Live)";
    statusBadge.className = "status-badge";
    console.log("Connected to WebSocket tunnel successfully.");
});

socket.on('disconnect', () => {
    statusBadge.innerText = "🔴 Disconnected";
    statusBadge.className = "status-badge disconnected";
});

// --- CARD ---
function renderComplaintCard(data) {
    const noDataMessage = document.querySelector('.no-data');
    if (noDataMessage) {
        noDataMessage.remove();
    }

    let severityClass = 'severity-low';
    if (data.score <= 24) {
        severityClass = 'severity-low';
    } else if (data.score >= 25 && data.score < 49) {
        severityClass = 'severity-medium';
    } else if (data.score >= 50 && data.score < 74) {
        severityClass = 'severity-high';
    } else if (data.score >= 75) {
        severityClass = 'severity-critical';
    }

    function generateComplaintCode() {
        const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
        const bytes = new Uint8Array(8);

        crypto.getRandomValues(bytes);

        let id = "";

        for (const b of bytes) {
            id += chars[b % chars.length];
        }

        return `ER-${id}`;
    }


    const complaintId = data.trackingid || data.trackingId;
    const categories = data.category || [];
    const studentId = data.studentId || data.studentID || "N/A";

    // create card
    const card = document.createElement('div');
    card.className = `complaint-card ${severityClass}`;

    card.id = complaintId;


    card.innerHTML = `
            <div class="item" data-category="${categories}">
        <div class="card-header">
            <span class="card-name">
                ${data.isAnonymous ? '🕵️ Anonymous Student' : '👤 ' + data.name} <span class="status"></span> 
                <div class="badge">
                    <input type="radio" name="status-${complaintId}" value="Pending" ${data.status === 'Pending' ? 'checked' : ''}> Pending
                    <input type="radio" name="status-${complaintId}" value="Resolved" ${data.status === 'Resolved' ? 'checked' : ''}> Resolved
                    <input type="radio" name="status-${complaintId}" value="Rejected" ${data.status === 'Rejected' ? 'checked' : ''}> Rejected
                </div>
            </span>
            <span>📅 ${data.date}</span>
        </div>

        <div class="card-body">
            <p><strong>Tracking ID:</strong> ${complaintId}</p>
            <p class="Category"><strong>Category:</strong> ${categories || 'N/A'}</p>
            <p><strong> Reason:</strong> ${data.reason || 'N/A'}</p>
             
             <div class="details">
            <p><strong>Student ID:</strong> ${studentId}</p>
            <p><strong> Email:</strong> ${data.email || 'N/A'}</p>
            <p><strong> Contact Number:</strong> ${data.contactNumber || 'N/A'}</p>
            <p>${data.text || "<em>No written details provided.</em>"}</p>
            </div>
               <div class="show-details">expand</div> 
        </div>

        <div class="card-footer">
            <span><strong>Section:</strong> ${data.section || 'N/A'}</span> 
            <div>
            <button class="del" onclick="deleteCard('${complaintId}')"></button>
            <span class="score-tag">Severity Score: ${data.score}</span>
            </div>
        </div>
        </div>
    `;


    const statusRadios = card.querySelectorAll(`input[name="status-${complaintId}"]`);

    statusRadios.forEach(radio => {
        radio.addEventListener('change', () => {
            console.log("Sending:", complaintId, radio.value);

            socket.emit('updateStatus', {
                trackingId: complaintId,
                status: radio.value
            });
        });
    });

    const statusElement = card.querySelector('.status');
    if (data.status === 'Resolved') {
        statusElement.innerHTML = '<span>🟢</span>';
    } else if (data.status === 'Pending') {
        statusElement.innerHTML = '<span>🟡</span>';
    } else if (data.status === 'Rejected') {
        statusElement.innerHTML = '<span>🔴</span>';
    }

    const categbox = document.querySelectorAll('#categories input[type="checkbox"]');
    const item = card.querySelector('.item');
    function filterItems() {
        const activeFilters = Array.from(categbox)
            .filter(box => box.checked)
            .map(box => box.value);

        const itemCategory = item.dataset.category;
        if (activeFilters.length === 0 || activeFilters.includes(itemCategory)) {
            card.style.display = "";
        } else {
            card.style.display = "none";
        }
    }

    categbox.forEach(box => {
        box.addEventListener("change", filterItems);
    });
    // Apply the filter immediately
    filterItems();


    function filter() {
        const categoryCheckboxes = document.querySelectorAll('#categories input[type="checkbox"]');
        const cardCategories = card.getElementsByClassName('card-header')[0].className.split(' ');
    }


    complaintList.insertBefore(card, complaintList.firstChild);

    const show = card.querySelector('.show-details');
    const text = card.querySelector('.details');
    show.addEventListener('click', () => {
        text.style.display = text.style.display === 'block' ? 'none' : 'block';
    });
}

function deleteCard(id) {
    const cardToDelete = document.getElementById(id);
    if (cardToDelete) {

        socket.emit('deleteComplaint', { trackingId: id });
        console.log(`Complaint card with ID ${id} deleted.`);
    } else {
        console.log(`No complaint card found with ID ${id}.`);
    }
}

socket.on('newComplaint', (data) => {
    console.log("Received live broadcast data:", data);
    renderComplaintCard(data);
});


socket.on('complaintHistory', (historyArray) => {
    console.log("Received database history:", historyArray);


    complaintList.innerHTML = '';


    historyArray.reverse().forEach(complaint => {
        renderComplaintCard(complaint);
    });
});


socket.on('statusUpdated', ({ trackingId, status }) => {

    console.log("statusUpdated:", trackingId, status);

    const card = document.getElementById(trackingId);
    console.log("Card found:", card);

    if (!card) return;

    const statusElement = card.querySelector(".status");

    if (status === "Resolved") {
        statusElement.innerHTML = "🟢";
    } else if (status === "Pending") {
        statusElement.innerHTML = "🟡";
    } else if (status === "Rejected") {
        statusElement.innerHTML = "🔴";
    }
});

socket.on("cardDeleted", ({ trackingId }) => {
    const card = document.getElementById(trackingId);

    if (card) {
        card.remove();
    }
});

window.addEventListener("load", () => {
    if (window.location.hash) {
        const target = document.querySelector(window.location.hash);

        if (target) {
            target.scrollIntoView({
                behavior: "smooth",
                block: "center"
            });

            target.style.outline = "4px solid gold";

            setTimeout(() => {
                target.style.outline = "";
            }, 4000);
        }
    }
});
